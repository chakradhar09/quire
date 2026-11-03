import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  deleteDocument, figuresElsewhere, getAiReport, getReport, listDrafts, mediaFile, openDatabase, retryReport, saveUpload, setMatchExcluded, setSourceExcluded,
  submitText, tx, updateReportSettings, moveToPaper, setResolution, getResolutions, workerState,
} from "./db.ts";
import { MAX_UPLOAD_BYTES } from "./upload.ts";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../db/migrations");

type T = { after: (fn: () => void) => void };

// A migrated database in a temp folder, built from the real migration files.
function tempDatabase(version?: number) {
  const dir = mkdtempSync(path.join(tmpdir(), "quire-"));
  const file = path.join(dir, "quire.db");
  const setup = new DatabaseSync(file);
  for (const name of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    setup.exec(readFileSync(path.join(MIGRATIONS, name), "utf8"));
  }
  if (version !== undefined) setup.exec(`pragma user_version = ${version}`);
  setup.close();
  return { file, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

// Opened through the code under test; closed before its folder is deleted (Windows locks open files).
function openTemp(t: T) {
  const { file, remove } = tempDatabase();
  const db = openDatabase(file);
  t.after(() => { db.close(); remove(); });
  return db;
}

test("openDatabase turns on foreign keys, WAL and the busy timeout", (t) => {
  const db = openTemp(t);
  assert.equal(db.prepare("pragma foreign_keys").get()?.foreign_keys, 1);
  assert.equal(db.prepare("pragma journal_mode").get()?.journal_mode, "wal");
  assert.equal(db.prepare("pragma busy_timeout").get()?.timeout, 5000);
});

test("openDatabase refuses a database at another version and says how to fix it", (t) => {
  const { file, remove } = tempDatabase(0);
  t.after(remove);
  assert.throws(() => openDatabase(file), /version 0.*python db\/migrate\.py/);
});

test("openDatabase refuses a missing file instead of creating an empty one", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "quire-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => openDatabase(path.join(dir, "nope.db")), /python db\/migrate\.py/);
  assert.deepEqual(readdirSync(dir), []);
});

test("tx commits what the function wrote and returns its result", (t) => {
  const db = openTemp(t);
  const id = tx(() => db.prepare("insert into documents (title) values ('Draft') returning id").get()?.id, db);
  assert.equal(id, 1);
  assert.equal(db.prepare("select count(*) as n from documents").get()?.n, 1);
});

test("tx rolls everything back when the function throws", (t) => {
  const db = openTemp(t);
  assert.throws(() => tx(() => {
    db.prepare("insert into documents (title) values ('Draft')").run();
    db.prepare("insert into documents (title, status) values ('Bad', 'rejected')").run(); // CHECK fails
  }, db), /CHECK constraint failed/);
  assert.equal(db.prepare("select count(*) as n from documents").get()?.n, 0);
  assert.doesNotThrow(() => tx(() => {}, db), "no transaction may be left open");
});

const TEXT = "Coral reefs cover less than one percent of the ocean floor.";

test("submitText stores an extracting draft with its raw text and queues one extract job", (t) => {
  const db = openTemp(t);
  const result = submitText("  Coral essay  ", TEXT, db);
  assert.ok("id" in result);
  const doc = db.prepare("select title, text, status from documents where id = ?").get(result.id);
  assert.deepEqual({ ...doc }, { title: "Coral essay", text: TEXT, status: "extracting" });
  const jobs = db.prepare("select kind, document_id, status from jobs").all().map((j) => ({ ...j }));
  assert.deepEqual(jobs, [{ kind: "extract", document_id: result.id, status: "queued" }]);
});

test("submitText refuses a missing or too long title and writes nothing", (t) => {
  const db = openTemp(t);
  assert.deepEqual(submitText("   ", TEXT, db), { error: "Give the draft a title." });
  assert.deepEqual(submitText("x".repeat(301), TEXT, db), { error: "Keep the title to 300 characters or fewer." });
  assert.equal(db.prepare("select count(*) as n from documents").get()?.n, 0);
});

test("submitText refuses empty text and text over 2 MB, counting bytes not characters", (t) => {
  const db = openTemp(t);
  assert.deepEqual(submitText("Draft", " \n ", db), { error: "Paste the text you want to check." });
  // 1.1 million two-byte characters: under 2 million characters, but over 2 MB.
  assert.deepEqual(submitText("Draft", "é".repeat(1_100_000), db),
    { error: "That text is over 2 MB. Paste a shorter part, or upload the file instead." });
  assert.equal(db.prepare("select count(*) as n from documents").get()?.n, 0);
});

test("listDrafts returns newest first with each draft's report state", (t) => {
  const db = openTemp(t);
  const first = submitText("First", TEXT, db);
  const second = submitText("Second", TEXT, db);
  assert.ok("id" in first && "id" in second);
  db.prepare("update documents set status = 'rejected', reject_reason = 'too_few_words' where id = ?").run(first.id);
  db.prepare("update documents set status = 'ready' where id = ?").run(second.id);
  const report = db.prepare("insert into similarity_reports (document_id, status, score) values (?, 'done', 34.5) returning id").get(second.id);
  db.prepare("insert into ai_reports (document_id) values (?)").run(second.id);

  const rows = listDrafts(db);

  assert.deepEqual(rows.map((r) => r.title), ["Second", "First"]);
  assert.deepEqual(
    { status: rows[0].status, reportId: rows[0].reportId, reportStatus: rows[0].reportStatus, score: rows[0].score, aiStatus: rows[0].aiStatus },
    { status: "ready", reportId: report?.id, reportStatus: "done", score: 34.5, aiStatus: "queued" });
  assert.deepEqual(
    { status: rows[1].status, rejectReason: rows[1].rejectReason, reportId: rows[1].reportId },
    { status: "rejected", rejectReason: "too_few_words", reportId: null });
});

// A finished report: source 1 is ranked with two matches, source 2 matched only words source 1 claimed.
function finishedReport(db: DatabaseSync) {
  const doc = Number(db.prepare(
    "insert into documents (title, text, status, word_count) values ('Mangroves', ?, 'ready', 40) returning id",
  ).get("Intro words here. Copied passage one. My own middle part. Copied passage two. The end.")?.id);
  const report = Number(db.prepare(
    "insert into similarity_reports (document_id, status, score, queries_used, generated_at)" +
    " values (?, 'done', 42.5, 6, '2026-10-29T10:00:00.000Z') returning id").get(doc)?.id);
  const src = (url: string) => Number(db.prepare(
    "insert into sources (type, url, title, text, text_hash) values ('internet', ?, 'T', 't', 'h')" +
    " on conflict (url) where url is not null do update set url = excluded.url returning id").get(url)?.id); // a second report reuses them
  const ranked = src("https://coastal.example/mangroves");
  const overlapped = src("https://mirror.example/copy");
  db.prepare("insert into report_sources (report_id, source_id, rank, percent, matched_words) values (?, ?, 1, 42.5, 17)").run(report, ranked);
  db.prepare("insert into report_sources (report_id, source_id, rank, percent, matched_words) values (?, ?, null, 0, 8)").run(report, overlapped);
  const match = (source: number, start: number, end: number, hidden: string | null = null) => db.prepare(
    "insert into matches (report_id, source_id, doc_start, doc_end, src_start, src_end, word_count, match_group, hidden_reason)" +
    " values (?, ?, ?, ?, 0, 10, 8, 'not_cited_or_quoted', ?)").run(report, source, start, end, hidden);
  match(ranked, 57, 77);
  match(ranked, 18, 37);
  match(overlapped, 18, 37);
  match(ranked, 0, 5, "quote");
  return report;
}

test("getReport returns the report, its draft and the highlight spans of ranked sources in order", (t) => {
  const db = openTemp(t);
  const id = finishedReport(db);

  const report = getReport(id, db);

  assert.ok(report);
  assert.deepEqual(
    { title: report.title, status: report.status, score: report.score, queriesUsed: report.queriesUsed },
    { title: "Mangroves", status: "done", score: 42.5, queriesUsed: 6 });
  assert.ok(report.text.startsWith("Intro words here."));
  assert.deepEqual(report.spans.map((s) => [s.start, s.end, s.rank, s.label]), [
    [18, 37, 1, "Source 1: coastal.example"],
    [57, 77, 1, "Source 1: coastal.example"],
  ]);
});

test("figuresElsewhere finds this draft's pictures in other uploads, not in its own versions", (t) => {
  const db = openTemp(t);
  const doc = (title: string, parent: number | null = null) => {
    const id = Number(db.prepare("insert into documents (title, status, text, parent_id) values (?, 'ready', 'x', ?) returning id")
      .get(title, parent)?.id);
    db.prepare("insert into similarity_reports (document_id) values (?)").run(id);
    return id;
  };
  const figure = (id: number, ordinal: number, hash: string) =>
    db.prepare("insert into figures (document_id, ordinal, hash) values (?, ?, ?)").run(id, ordinal, hash);
  const mine = doc("Mangroves v2", doc("Mangroves v1"));
  const other = doc("Lab report");
  figure(mine, 1, "f0f0f0f0f0f0f0f0");
  figure(mine, 2, "0123456789abcdef");
  figure(mine - 1, 1, "f0f0f0f0f0f0f0f0");   // the earlier version: expected to share figures
  figure(other, 3, "f0f0f0f0f0f0f0f3");      // 2 bits from figure 1: the same picture
  figure(other, 4, "fedcba9876543210");      // far from both

  const reportId = Number(db.prepare("select id from similarity_reports where document_id = ?").get(other)?.id);
  assert.deepEqual(figuresElsewhere(mine, db), [{ figure: 1, otherTitle: "Lab report", otherReportId: reportId, otherFigure: 3 }]);
});

test("getReport returns null for a report that does not exist", (t) => {
  const db = openTemp(t);
  assert.equal(getReport(999, db), null);
});

// A data folder for uploads, separate from the database file, removed after the test.
function tempDataDir(t: T) {
  const dir = mkdtempSync(path.join(tmpdir(), "quire-data-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const DOCX_BYTES = new TextEncoder().encode("PK fake docx bytes");

test("saveUpload stores the file under uploads/{id}/ and queues extraction", (t) => {
  const db = openTemp(t);
  const dataDir = tempDataDir(t);

  const result = saveUpload("Coral essay", "Coral essay.docx", DOCX_BYTES, db, dataDir);

  assert.ok("id" in result);
  const doc = db.prepare("select title, filename, file_path, mime, size_bytes, status, text from documents where id = ?").get(result.id);
  assert.deepEqual({ ...doc }, {
    title: "Coral essay", filename: "Coral essay.docx", file_path: `uploads/${result.id}/original.docx`,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size_bytes: DOCX_BYTES.byteLength, status: "extracting", text: null,
  });
  assert.deepEqual([...readFileSync(path.join(dataDir, "uploads", String(result.id), "original.docx"))], [...DOCX_BYTES]);
  assert.equal(db.prepare("select count(*) as n from jobs where kind = 'extract' and status = 'queued'").get()?.n, 1);
});

test("saveUpload never lets the file name choose where the file goes", (t) => {
  const db = openTemp(t);
  const dataDir = tempDataDir(t);
  const result = saveUpload("Evil", "../../evil.docx", DOCX_BYTES, db, dataDir);
  assert.ok("id" in result);
  assert.equal(db.prepare("select filename from documents").get()?.filename, "evil.docx");
  assert.deepEqual(readdirSync(dataDir), ["uploads"]);
  assert.deepEqual(readdirSync(path.join(dataDir, "uploads", String(result.id))), ["original.docx"]);
  assert.ok(!existsSync(path.join(dataDir, "..", "evil.docx")));
});

test("saveUpload refuses a bad title, type or size and writes nothing", (t) => {
  const db = openTemp(t);
  const dataDir = tempDataDir(t);
  assert.deepEqual(saveUpload(" ", "a.docx", DOCX_BYTES, db, dataDir), { error: "Give the draft a title." });
  const wrongType = saveUpload("A", "a.pages", DOCX_BYTES, db, dataDir);
  assert.ok("error" in wrongType && /not a file type/.test(wrongType.error));
  const tooBig = saveUpload("A", "a.pdf", new Uint8Array(MAX_UPLOAD_BYTES + 1), db, dataDir);
  assert.ok("error" in tooBig && /over 50 MB/.test(tooBig.error));
  assert.equal(db.prepare("select count(*) as n from documents").get()?.n, 0);
  assert.deepEqual(readdirSync(dataDir), []);
});

test("saveUpload leaves no draft behind when the file cannot be written", (t) => {
  const db = openTemp(t);
  const dataDir = tempDataDir(t);
  writeFileSync(path.join(dataDir, "uploads"), "a file where the uploads folder should be");
  assert.throws(() => saveUpload("A", "a.docx", DOCX_BYTES, db, dataDir));
  assert.equal(db.prepare("select count(*) as n from documents").get()?.n, 0);
  assert.equal(db.prepare("select count(*) as n from jobs").get()?.n, 0);
});

test("deleteDocument removes the draft, everything attached to it, and its upload folder", (t) => {
  const db = openTemp(t);
  const dataDir = tempDataDir(t);
  const gone = saveUpload("Gone", "gone.docx", DOCX_BYTES, db, dataDir);
  const kept = saveUpload("Kept", "kept.docx", DOCX_BYTES, db, dataDir);
  assert.ok("id" in gone && "id" in kept);
  db.prepare("insert into similarity_reports (document_id) values (?)").run(gone.id);

  assert.equal(deleteDocument(gone.id, db, dataDir), true);

  assert.deepEqual(db.prepare("select title from documents").all().map((r) => r.title), ["Kept"]);
  assert.equal(db.prepare("select count(*) as n from similarity_reports").get()?.n, 0);
  assert.equal(db.prepare("select count(*) as n from jobs where document_id = ?").get(gone.id)?.n, 0);
  assert.deepEqual(readdirSync(path.join(dataDir, "uploads")), [String(kept.id)]);
});

test("deleteDocument ignores ids that are not a real draft", (t) => {
  const db = openTemp(t);
  const dataDir = tempDataDir(t);
  assert.equal(deleteDocument(999, db, dataDir), false);
  for (const bad of [0, -1, 1.5, Number.NaN]) assert.equal(deleteDocument(bad, db, dataDir), false, String(bad));
});

test("getReport lists every source in rank order, unranked and excluded ones last, with the filter settings", (t) => {
  const db = openTemp(t);
  const id = finishedReport(db);
  db.prepare("update similarity_reports set exclude_quotes = 1, small_match_words = 12 where id = ?").run(id);
  db.prepare("update documents set bibliography_start = 70").run();

  const report = getReport(id, db);

  assert.ok(report);
  assert.deepEqual(report.sources.map((s) => [s.rank, s.percent, s.matchedWords, s.host, s.type, s.excluded]), [
    [1, 42.5, 17, "coastal.example", "internet", false],
    [null, 0, 8, "mirror.example", "internet", false],
  ]);
  assert.deepEqual(report.settings, { excludeQuotes: true, excludeBibliography: false, smallMatchWords: 12 });
  assert.equal(report.bibliographyStart, 70);
});

test("getReport returns each match with its source passage in context and why it is hidden", (t) => {
  const db = openTemp(t);
  const id = finishedReport(db);
  db.prepare("update sources set text = ? where url like '%coastal%'").run("Lead in. " + "x".repeat(200) + " Copied passage one. Then more.");
  db.prepare("update matches set src_start = 210, src_end = 229 where doc_start = 18").run();

  const report = getReport(id, db);

  assert.ok(report);
  assert.deepEqual(report.matches.map((m) => [m.start, m.rank, m.hidden]), [
    [0, 1, "quote"], [18, 1, null], [18, null, null], [57, 1, null]]);
  const [before, hit, after] = report.matches[1].source;
  assert.equal(hit, "Copied passage one.");
  assert.equal(before.length, 150);
  assert.equal(after, " Then more.");
});

test("listDrafts marks a draft waiting when a queued job has sat for over a minute", (t) => {
  const db = openTemp(t);
  const fresh = submitText("Fresh", TEXT, db);
  const stale = submitText("Stale", TEXT, db);
  assert.ok("id" in fresh && "id" in stale);
  db.prepare("update jobs set run_after = '2020-01-01T00:00:00.000Z' where document_id = ?").run(stale.id);

  const waiting = Object.fromEntries(listDrafts(db).map((d) => [d.title, d.waiting]));

  assert.deepEqual(waiting, { Fresh: false, Stale: true });
});

test("retryReport sends a failed report back to the queue with one similarity job", (t) => {
  const db = openTemp(t);
  const id = finishedReport(db);
  assert.equal(retryReport(id, db), false, "a finished report is not retried");
  db.prepare("update similarity_reports set status = 'error', error = 'boom' where id = ?").run(id);

  assert.equal(retryReport(id, db), true);
  assert.equal(retryReport(id, db), false, "a second click changes nothing");

  assert.deepEqual({ ...db.prepare("select status, error from similarity_reports where id = ?").get(id) },
    { status: "queued", error: null });
  assert.equal(db.prepare("select count(*) as n from jobs where kind = 'similarity' and report_id = ?").get(id)?.n, 1);
});

const rescoreJobs = (db: DatabaseSync) =>
  db.prepare("select count(*) as n from jobs where kind = 'rescore' and status = 'queued'").get()?.n;
const reportStatus = (db: DatabaseSync, id: number) =>
  db.prepare("select status from similarity_reports where id = ?").get(id)?.status;

test("updateReportSettings saves the filters and queues one rescore, however many times it is called", (t) => {
  const db = openTemp(t);
  const id = finishedReport(db);

  assert.deepEqual(updateReportSettings(id, { excludeQuotes: true, excludeBibliography: true, smallMatchWords: 10 }, db), {});
  updateReportSettings(id, { excludeQuotes: false, excludeBibliography: true, smallMatchWords: 10 }, db);

  assert.deepEqual({ ...db.prepare("select exclude_quotes as q, exclude_bibliography as b, small_match_words as w from similarity_reports").get() },
    { q: 0, b: 1, w: 10 });
  assert.equal(reportStatus(db, id), "recalculating");
  assert.equal(rescoreJobs(db), 1);
});

test("updateReportSettings refuses a small-match size outside 0 to 1000 whole words", (t) => {
  const db = openTemp(t);
  const id = finishedReport(db);
  for (const bad of [-1, 1001, 2.5, Number.NaN]) {
    const result = updateReportSettings(id, { excludeQuotes: false, excludeBibliography: false, smallMatchWords: bad }, db);
    assert.ok("error" in result, String(bad));
  }
  assert.equal(reportStatus(db, id), "done");
  assert.equal(rescoreJobs(db), 0);
});

test("setSourceExcluded and setMatchExcluded flag only rows of this report and queue a rescore", (t) => {
  const db = openTemp(t);
  const id = finishedReport(db);
  const other = finishedReport(db);
  const source = Number(db.prepare("select source_id from report_sources where report_id = ? and rank = 1").get(id)?.source_id);
  const match = Number(db.prepare("select id from matches where report_id = ? order by id limit 1").get(id)?.id);
  const foreign = Number(db.prepare("select id from matches where report_id = ? order by id limit 1").get(other)?.id);

  assert.equal(setSourceExcluded(id, source, true, db), true);
  assert.equal(setMatchExcluded(id, match, true, db), true);
  assert.equal(setMatchExcluded(id, foreign, true, db), false, "a match from another report");

  assert.equal(db.prepare("select excluded from report_sources where report_id = ? and source_id = ?").get(id, source)?.excluded, 1);
  assert.equal(db.prepare("select excluded from matches where id = ?").get(match)?.excluded, 1);
  assert.equal(db.prepare("select excluded from matches where id = ?").get(foreign)?.excluded, 0);
  assert.equal(reportStatus(db, id), "recalculating");
  assert.equal(reportStatus(db, other), "done");
  assert.equal(rescoreJobs(db), 1);

  setSourceExcluded(id, source, false, db);
  assert.equal(db.prepare("select excluded from report_sources where report_id = ? and source_id = ?").get(id, source)?.excluded, 0);
});

test("a report still being checked takes the change but queues no rescore: the check scores with it", (t) => {
  const db = openTemp(t);
  const id = finishedReport(db);
  db.prepare("update similarity_reports set status = 'processing' where id = ?").run(id);
  updateReportSettings(id, { excludeQuotes: true, excludeBibliography: false, smallMatchWords: 0 }, db);
  assert.equal(reportStatus(db, id), "processing");
  assert.equal(rescoreJobs(db), 0);
});

test("getAiReport returns the draft with its AI estimate, segments parsed and the model's calibration", (t) => {
  const db = openTemp(t);
  const doc = Number(db.prepare("insert into documents (title, text, status, bibliography_start) values ('Essay', 'Some text.', 'ready', 5) returning id").get()?.id);
  db.prepare("insert into ai_reports (document_id, status, score, qualifying_words, segments, model) values (?, 'done', 33.33, 420, ?, ?)")
    .run(doc, JSON.stringify([{ start: 0, end: 4, label: "ai", p: 0.5 }]),
      JSON.stringify({ detector: "binoculars", threshold: 0.9, calibrated: true, falsePositiveRate: 0.01 }));

  const report = getAiReport(doc, db);

  assert.ok(report);
  assert.deepEqual(
    { title: report.title, status: report.status, score: report.score, words: report.qualifyingWords, bib: report.bibliographyStart },
    { title: "Essay", status: "done", score: 33.33, words: 420, bib: 5 });
  assert.deepEqual(report.segments, [{ start: 0, end: 4, label: "ai", p: 0.5 }]);
  assert.equal(report.calibration?.calibrated, true);
});

test("getAiReport treats a model that is not JSON as uncalibrated and a missing report as null", (t) => {
  const db = openTemp(t);
  const doc = Number(db.prepare("insert into documents (title, text, status) values ('Essay', 'x', 'ready') returning id").get()?.id);
  db.prepare("insert into ai_reports (document_id, model) values (?, 'stand-in')").run(doc);
  assert.equal(getAiReport(doc, db)?.calibration, null);
  assert.equal(getAiReport(999, db), null);
});

test("getReport and getAiReport return the draft's layout, or null when it has none", (t) => {
  const db = openTemp(t);
  const blocks = [{ t: "h1", r: [0, 5] }, { t: "img", n: 1, w: 200, ocr: [], src: "1.png" }];
  const doc = Number(db.prepare("insert into documents (title, text, status, layout) values ('Essay', 'Coral reefs.', 'ready', ?) returning id")
    .get(JSON.stringify(blocks))?.id);
  db.prepare("insert into ai_reports (document_id) values (?)").run(doc);
  const report = Number(db.prepare("insert into similarity_reports (document_id) values (?) returning id").get(doc)?.id);
  assert.deepEqual(getAiReport(doc, db)?.layout, blocks);
  assert.deepEqual(getReport(report, db)?.layout, blocks);
  db.prepare("update documents set layout = null").run();
  assert.equal(getReport(report, db)?.layout, null);
});

test("mediaFile only names pictures inside a draft's own media folder", () => {
  const dir = path.join("data");
  assert.equal(mediaFile("3", "1.png", dir), path.join(dir, "uploads", "3", "media", "1.png"));
  assert.equal(mediaFile("3", "12.jpg", dir), path.join(dir, "uploads", "3", "media", "12.jpg"));
  for (const [id, name] of [["3", "../original.docx"], ["3", "1.svg"], ["3", "x.png"], ["../3", "1.png"], ["3", "1.png/"]]) {
    assert.equal(mediaFile(id, name, dir), null, `${id}/${name}`);
  }
});

test("a new version joins its paper as the newest version, whichever draft of the paper is named", (t) => {
  const db = openTemp(t);
  const v1 = submitText("Essay", TEXT, db) as { id: number };
  const v2 = submitText("Essay v2", TEXT, db, v1.id) as { id: number };
  const v3 = submitText("Essay v3", TEXT, db, v1.id) as { id: number };
  const parent = (id: number) => db.prepare("select parent_id as p from documents where id = ?").get(id)?.p;
  assert.equal(parent(v2.id), v1.id);
  assert.equal(parent(v3.id), v2.id);
  assert.equal(parent((submitText("Other", TEXT, db, 9999) as { id: number }).id), null);
});

test("moveToPaper attaches a draft to another paper or splits it off, never into its own chain", (t) => {
  const db = openTemp(t);
  const a = submitText("A", TEXT, db) as { id: number };
  const a2 = submitText("A2", TEXT, db, a.id) as { id: number };
  const b = submitText("B", TEXT, db) as { id: number };
  const parent = (id: number) => db.prepare("select parent_id as p from documents where id = ?").get(id)?.p;
  assert.equal(moveToPaper(b.id, a.id, db), true);
  assert.equal(parent(b.id), a2.id);
  assert.equal(moveToPaper(a.id, b.id, db), false, "a draft cannot move under its own later version");
  assert.equal(parent(a.id), null);
  assert.equal(moveToPaper(b.id, null, db), true);
  assert.equal(parent(b.id), null);
});

test("setResolution records, replaces and undoes a decision, and the schema refuses nonsense", (t) => {
  const db = openTemp(t);
  const { id } = submitText("Essay", TEXT, db) as { id: number };
  setResolution(id, "match", 10, 40, "cited", db);
  setResolution(id, "match", 10, 40, "rewritten", db);
  setResolution(id, "ai", 50, 90, "kept", db);
  assert.deepEqual(getResolutions(id, db).map((r) => [r.kind, r.start, r.end, r.state]),
    [["match", 10, 40, "rewritten"], ["ai", 50, 90, "kept"]]);
  // Rows go to client components, which accept only plain objects (node:sqlite rows have no prototype).
  assert.equal(Object.getPrototypeOf(getResolutions(id, db)[0]), Object.prototype);
  setResolution(id, "match", 10, 40, null, db);
  assert.equal(getResolutions(id, db).length, 1);
  assert.throws(() => setResolution(id, "match", 1, 2, "kept", db), /constraint/i, "a match cannot be kept");
  assert.throws(() => setResolution(id, "ai", 1, 2, "cited", db), /constraint/i, "an AI passage cannot be cited");
});

test("resolutions go when their draft is deleted", (t) => {
  const db = openTemp(t);
  const { id } = submitText("Essay", TEXT, db) as { id: number };
  setResolution(id, "match", 10, 40, "cited", db);
  deleteDocument(id, db, mkdtempSync(path.join(tmpdir(), "quire-up-")));
  assert.equal(getResolutions(id, db).length, 0);
});

test("workerState is idle with no jobs, working with fresh ones, stalled when one has waited over a minute", (t) => {
  const db = openTemp(t);
  assert.deepEqual(workerState(db), { state: "idle", queued: 0 });
  const { id } = submitText("Essay", TEXT, db) as { id: number };
  assert.deepEqual(workerState(db), { state: "working", queued: 1 });
  db.prepare("update jobs set run_after = '2000-01-01T00:00:00.000Z' where document_id = ?").run(id);
  assert.deepEqual(workerState(db), { state: "stalled", queued: 1 });
});
