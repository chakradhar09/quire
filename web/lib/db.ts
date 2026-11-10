// The only file that touches the database. Server-side only.
// Pages that read through it call `await connection()` first: node:sqlite is synchronous,
// so without that Next would run the query at build time and bake the result into the page.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LayoutBlock } from "./report.ts";
import { MIME, checkUpload, extensionOf, fileName, titleError } from "./upload.ts";

export const SCHEMA_VERSION = 5;

const FIX = "Run: python db/migrate.py (from the project root)";

export function databasePath() {
  // npm runs scripts in web/, so the default is the project root's data/ folder.
  return process.env.DATABASE_PATH || path.resolve(process.cwd(), "../data/quire.db");
}

export function openDatabase(file: string) {
  if (!existsSync(file)) throw new Error(`No database at ${file}. ${FIX}`);
  const db = new DatabaseSync(file);
  db.exec("pragma foreign_keys = on; pragma journal_mode = wal; pragma busy_timeout = 5000;");
  const version = Number(db.prepare("pragma user_version").get()?.user_version);
  if (version !== SCHEMA_VERSION) {
    db.close();
    throw new Error(`Database ${file} is at version ${version}, this app needs ${SCHEMA_VERSION}. ${FIX}`);
  }
  return db;
}

// One handle per server process, kept across dev reloads. Opened on first use, never at build time.
const cache = globalThis as { draftcheckDb?: DatabaseSync };

export function db() {
  cache.draftcheckDb ??= openDatabase(databasePath());
  return cache.draftcheckDb;
}

const MAX_PASTE_BYTES = 2 * 1024 * 1024;

// S04 paste: the draft and its extract job in one transaction. Checks are plain on purpose:
// the only person typing here is the owner, and the schema's CHECKs back them up.
// paper: any draft of the paper this is a new version of; the text joins that chain as its newest version.
export function submitText(title: string, text: string, conn: DatabaseSync = db(), paper?: number): { id: number } | { error: string } {
  const titleProblem = titleError(title);
  if (titleProblem) return { error: titleProblem };
  const name = title.trim();
  if (!text.trim()) return { error: "Paste the text you want to check." };
  if (Buffer.byteLength(text, "utf8") > MAX_PASTE_BYTES) {
    return { error: "That text is over 2 MB. Paste a shorter part, or upload the file instead." };
  }
  return tx(() => {
    const id = Number(conn.prepare("insert into documents (title, text, parent_id) values (?, ?, ?) returning id")
      .get(name, text, newestVersion(paper, conn))?.id);
    conn.prepare("insert into jobs (kind, document_id) values ('extract', ?) on conflict do nothing").run(id);
    return { id };
  }, conn);
}

// Uploaded files live next to the database: data/uploads/{id}/original{.ext}.
export const dataDirectory = () => path.dirname(databasePath());

// A draft's picture on disk, for /documents/{id}/media/{name}; null for anything that isn't one of the
// worker's own file names, so a request can never reach outside data/uploads/{id}/media/.
export function mediaFile(id: string, name: string, dataDir = dataDirectory()) {
  if (!/^\d+$/.test(id) || !/^\d+\.(png|jpg|gif|webp)$/.test(name)) return null;
  return path.join(dataDir, "uploads", id, "media", name);
}

// S04 upload: the draft, its file and its extract job. The file name you chose is only stored for
// display; the path on disk is built from the row id, so a name can never point anywhere else.
export function saveUpload(
  title: string, name: string, bytes: Uint8Array, conn: DatabaseSync = db(), dataDir = dataDirectory(), paper?: number,
): { id: number } | { error: string } {
  const filename = fileName(name);
  const problem = titleError(title) ?? checkUpload(filename, bytes.byteLength);
  if (problem) return { error: problem };
  const ext = extensionOf(filename);
  return tx(() => {
    const id = Number(conn.prepare(
      "insert into documents (title, filename, file_path, mime, size_bytes, parent_id) values (?, ?, 'pending', ?, ?, ?) returning id",
    ).get(title.trim(), filename, MIME[ext], bytes.byteLength, newestVersion(paper, conn))?.id);
    const relative = `uploads/${id}/original${ext}`;
    conn.prepare("update documents set file_path = ? where id = ?").run(relative, id);
    conn.prepare("insert into jobs (kind, document_id) values ('extract', ?) on conflict do nothing").run(id);
    const folder = path.join(dataDir, "uploads", String(id));
    try {
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(dataDir, relative), bytes);
    } catch (e) {
      rmSync(folder, { recursive: true, force: true });
      throw e; // tx rolls the row and job back
    }
    return { id };
  }, conn);
}

// Delete a draft for good: the row (its reports, matches, flags and jobs cascade), then its upload
// folder, whose path comes from the integer id only. Library sources (M3) will also need the other
// reports that matched this draft rescored here.
export function deleteDocument(id: number, conn: DatabaseSync = db(), dataDir = dataDirectory()) {
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const deleted = tx(() => Number(conn.prepare("delete from documents where id = ?").run(id).changes) > 0, conn);
  rmSync(path.join(dataDir, "uploads", String(id)), { recursive: true, force: true });
  return deleted;
}

// ---------------------------------------------------------------- Papers
// A paper is a chain of drafts: each new version's parent_id is the version before it. Any draft id
// names its paper; the newest version is where the next one attaches. Null when there is no such draft.
function newestVersion(anyDraft: number | undefined, conn: DatabaseSync): number | null {
  if (!anyDraft || !Number.isSafeInteger(anyDraft)) return null;
  const row = conn.prepare(`
    with recursive up(id, parent_id) as (
      select id, parent_id from documents where id = ?
      union select d.id, d.parent_id from documents d join up on d.id = up.parent_id),
    root as (select id from up where parent_id is null),
    down(id) as (select id from root union select d.id from documents d join down on d.parent_id = down.id)
    select d.id from documents d join down using (id) order by d.created_at desc, d.id desc limit 1`).get(anyDraft);
  return row ? Number(row.id) : null;
}

// Home "Move to paper": the draft (and the versions after it) become the newest versions of another
// paper, or, with null, a paper of their own. Refuses a move into its own chain.
export function moveToPaper(id: number, paper: number | null, conn: DatabaseSync = db()) {
  return tx(() => {
    const parent = paper === null ? null : newestVersion(paper, conn);
    if (paper !== null && parent === null) return false;
    if (parent !== null) {
      const own = conn.prepare(`
        with recursive down(id) as (select ? union select d.id from documents d join down on d.parent_id = down.id)
        select 1 from down where id = ?`).get(id, parent);
      if (own) return false;
    }
    return Number(conn.prepare("update documents set parent_id = ? where id = ?").run(parent, id).changes) > 0;
  }, conn);
}

// ---------------------------------------------------------------- Resolutions
export type ResolutionState = "cited" | "rewritten" | "kept";
export type Resolution = { kind: "match" | "ai"; start: number; end: number; state: ResolutionState; at: string };

export function getResolutions(documentId: number, conn: DatabaseSync = db()): Resolution[] {
  // Plain objects: the rows go to a client component, which refuses node:sqlite's prototype-less rows.
  return conn.prepare(`select kind, start, "end", state, created_at as at from resolutions where document_id = ? order by start`)
    .all(documentId).map((r) => ({ ...r })) as unknown as Resolution[];
}

// state null undoes the decision. The schema refuses combinations that make no sense (a match kept, an AI passage cited).
export function setResolution(documentId: number, kind: "match" | "ai", start: number, end: number, state: ResolutionState | null, conn: DatabaseSync = db()) {
  if (state === null) {
    conn.prepare(`delete from resolutions where document_id = ? and kind = ? and start = ? and "end" = ?`).run(documentId, kind, start, end);
    return;
  }
  conn.prepare(`insert into resolutions (document_id, kind, start, "end", state) values (?, ?, ?, ?, ?)
    on conflict (document_id, kind, start, "end") do update set state = excluded.state, created_at = excluded.created_at`)
    .run(documentId, kind, start, end, state);
}

// ---------------------------------------------------------------- Worker
// The header's worker light. There is no heartbeat: a job left queued for over a minute means the
// worker is not running; a running job means it is working.
export function workerState(conn: DatabaseSync = db()): { state: "idle" | "working" | "stalled"; queued: number } {
  const row = conn.prepare(`
    select sum(status = 'running') as running, sum(status = 'queued') as queued,
           sum(status = 'queued' and run_after < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 seconds')) as stale
      from jobs where status in ('queued', 'running')`).get() as { running: number | null; queued: number | null; stale: number | null };
  const queued = Number(row.queued ?? 0);
  return { state: Number(row.stale ?? 0) > 0 ? "stalled" : Number(row.running ?? 0) > 0 || queued > 0 ? "working" : "idle", queued };
}

export type Draft = {
  id: number;
  parentId: number | null;
  title: string;
  createdAt: string;
  status: "extracting" | "ready" | "rejected";
  rejectReason: string | null;
  reportId: number | null;
  reportStatus: "queued" | "processing" | "recalculating" | "done" | "error" | null;
  score: number | null;
  aiStatus: "queued" | "processing" | "done" | "unavailable" | "error" | null;
  aiScore: number | null;
  aiReason: "too_few_words" | "unsupported_language" | null;
  waiting: boolean;
};

// S03: every draft, newest first, with the state of both its checks. `waiting`: one of its jobs has
// been runnable for over a minute, so the worker is probably not running.
export function listDrafts(conn: DatabaseSync = db()): Draft[] {
  return (conn.prepare(`
    select d.id, d.parent_id as parentId, d.title, d.created_at as createdAt, d.status, d.reject_reason as rejectReason,
           r.id as reportId, r.status as reportStatus, r.score,
           a.status as aiStatus, a.score as aiScore, a.unavailable_reason as aiReason,
           exists (select 1 from jobs j
                    where j.status = 'queued' and j.kind in ('extract', 'similarity', 'rescore', 'ai')
                      and (j.document_id = d.id or j.report_id = r.id)
                      and j.run_after < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 seconds')) as waiting
      from documents d
      left join similarity_reports r on r.document_id = d.id
      left join ai_reports a on a.document_id = d.id
     order by d.created_at desc, d.id desc`).all() as unknown as (Omit<Draft, "waiting"> & { waiting: number })[])
    .map((d) => ({ ...d, waiting: d.waiting === 1 }));
}

export type ReportSettings = { excludeQuotes: boolean; excludeBibliography: boolean; smallMatchWords: number };

export type ReportSource = {
  sourceId: number; rank: number | null; percent: number; matchedWords: number;
  title: string; url: string | null; host: string; type: "internet" | "publication" | "library"; excluded: boolean;
};

// One aligned span. `rank` is its source's; `hidden` is rescore's reason, null when it counts.
// `source` is the source's passage as [before, matched, after].
export type ReportMatch = {
  id: number; sourceId: number; start: number; end: number; rank: number | null;
  hidden: string | null; excluded: boolean; source: [string, string, string];
};

export type ReportView = {
  id: number;
  documentId: number;
  title: string;
  text: string;
  status: "queued" | "processing" | "recalculating" | "done" | "error";
  score: number | null;
  error: string | null;
  queriesUsed: number;
  generatedAt: string | null;
  bibliographyStart: number | null;
  layout: LayoutBlock[] | null;
  settings: ReportSettings;
  sources: ReportSource[];
  matches: ReportMatch[];
  spans: { id: string; start: number; end: number; rank: number; label: string }[];
  references: ReferenceCheck[];
};

// One entry of the reference list as the similarity check read it (worker/references.py).
export type ReferenceCheck = {
  start: number; end: number; title: string | null; status: "found" | "not_found" | "no_title";
  foundTitle: string | null; foundUrl: string | null; foundYear: number | null;
};

const CONTEXT = 150; // characters of source text shown on each side of a match

const host = (url: string | null, fallback: string) => {
  try {
    return url ? new URL(url).host : fallback;
  } catch {
    return url ?? fallback;
  }
};

// S07: the report, its draft text, and one highlight per counted match. A match only draws if its
// source has a rank (a source whose words were all claimed by a better one draws nothing) and
// rescore left it visible. Sources come ranked first, then unranked, then excluded.
export function getReport(id: number, conn: DatabaseSync = db()): ReportView | null {
  const report = conn.prepare(`
    select r.id, d.id as documentId, d.title, d.text, r.status, r.score, r.error, r.queries_used as queriesUsed, r.generated_at as generatedAt,
           d.bibliography_start as bibliographyStart, d.layout, r.exclude_quotes as excludeQuotes,
           r.exclude_bibliography as excludeBibliography, r.small_match_words as smallMatchWords
      from similarity_reports r join documents d on d.id = r.document_id
     where r.id = ?`).get(id) as (Omit<ReportView, "settings" | "sources" | "matches" | "spans" | "layout"> &
       { excludeQuotes: number; excludeBibliography: number; smallMatchWords: number; layout: string | null }) | undefined;
  if (!report) return null;
  const { excludeQuotes, excludeBibliography, smallMatchWords, layout, ...rest } = report;
  const head = { ...rest, layout: layout === null ? null : JSON.parse(layout) as LayoutBlock[] };

  const sources = (conn.prepare(`
    select rs.source_id as sourceId, rs.rank, rs.percent, rs.matched_words as matchedWords, rs.excluded, s.title, s.url, s.type
      from report_sources rs join sources s on s.id = rs.source_id
     where rs.report_id = ?
     order by rs.excluded, rs.rank is null, rs.rank, rs.matched_words desc, rs.source_id`).all(id) as unknown as
       (Omit<ReportSource, "host" | "excluded" | "title"> & { excluded: number; title: string | null })[])
    .map((s) => {
      const name = host(s.url, "My library");
      return { ...s, title: s.title || name, host: name, excluded: s.excluded === 1 };
    });

  // Source passages are cut in SQL, which counts characters the way the worker's offsets do.
  const matches = (conn.prepare(`
    select m.id, m.source_id as sourceId, m.doc_start as start, m.doc_end as "end", rs.rank,
           m.hidden_reason as hidden, m.excluded,
           substr(s.text, max(1, m.src_start + 1 - ${CONTEXT}), m.src_start - max(0, m.src_start - ${CONTEXT})) as before,
           substr(s.text, m.src_start + 1, m.src_end - m.src_start) as hit,
           substr(s.text, m.src_end + 1, ${CONTEXT}) as after
      from matches m
      join report_sources rs on rs.report_id = m.report_id and rs.source_id = m.source_id
      join sources s on s.id = m.source_id
     where m.report_id = ?
     order by m.doc_start, rs.rank is null, rs.rank, m.id`).all(id) as unknown as
       (Omit<ReportMatch, "excluded" | "source"> & { excluded: number; before: string; hit: string; after: string })[])
    .map(({ before, hit, after, excluded, ...m }) =>
      ({ ...m, excluded: excluded === 1, source: [before, hit, after] as [string, string, string] }));

  const hostOf = new Map(sources.map((s) => [s.sourceId, s.host]));
  const references = (conn.prepare(`
    select start, "end", title, status, found_title as foundTitle, found_url as foundUrl, found_year as foundYear
      from reference_checks where report_id = ? order by start`).all(id) as unknown as ReferenceCheck[])
    .map((r) => ({ ...r })); // node:sqlite rows have a null prototype, which a client component can't take
  return {
    ...head,
    references,
    settings: { excludeQuotes: excludeQuotes === 1, excludeBibliography: excludeBibliography === 1, smallMatchWords },
    sources,
    matches,
    spans: matches.filter((m) => m.rank !== null && m.hidden === null).map((m) => ({
      id: String(m.id), start: m.start, end: m.end, rank: m.rank as number, label: `Source ${m.rank}: ${hostOf.get(m.sourceId)}`,
    })),
  };
}

export type ReusedFigure = { figure: number; otherTitle: string; otherReportId: number | null; otherFigure: number };

// Bits of 64 within which two pictures' perceptual hashes count as the same figure: worker/figures.py SAME.
const SAME_FIGURE = 10;

const bitsApart = (a: string, b: string) => {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), n = 0;
  for (; x; x &= x - BigInt(1)) n++; // not 1n: tsconfig targets ES2017
  return n;
};

// Pictures in this draft that also appear in another upload, compared by the hashes the extract job stored.
// The draft's own earlier and later versions (parent_id) are left out: they are expected to share figures.
// ponytail: compares against every stored figure in JS; one person's uploads are a few hundred pictures.
export function figuresElsewhere(documentId: number, conn: DatabaseSync = db()): ReusedFigure[] {
  const mine = conn.prepare("select ordinal, hash from figures where document_id = ? order by ordinal")
    .all(documentId) as { ordinal: number; hash: string }[];
  if (!mine.length) return [];
  const others = conn.prepare(`
    select f.ordinal, f.hash, o.title, r.id as reportId
      from figures f join documents o on o.id = f.document_id
      join documents d on d.id = ?
      left join similarity_reports r on r.document_id = o.id
     where o.id <> d.id and o.id is not d.parent_id and o.parent_id is not d.id
     order by o.created_at desc, o.id, f.ordinal`).all(documentId) as
       { ordinal: number; hash: string; title: string; reportId: number | null }[];
  return mine.flatMap((m) => others.filter((o) => bitsApart(m.hash, o.hash) <= SAME_FIGURE).map((o) =>
    ({ figure: m.ordinal, otherTitle: o.title, otherReportId: o.reportId, otherFigure: o.ordinal })));
}

// What the worker records in ai_reports.model (T11); anything else counts as uncalibrated.
export type AiCalibration = {
  detector?: string; observer?: string; performer?: string; threshold?: number;
  calibrated: boolean; falsePositiveRate?: number; detectionRate?: number;
};

export type AiReportView = {
  documentId: number;
  title: string;
  text: string;
  bibliographyStart: number | null;
  layout: LayoutBlock[] | null;
  status: "queued" | "processing" | "done" | "unavailable" | "error";
  unavailableReason: "too_few_words" | "unsupported_language" | null;
  score: number | null;
  qualifyingWords: number | null;
  segments: { start: number; end: number; label: "ai" | "ai-paraphrased"; p: number }[];
  calibration: AiCalibration | null;
  error: string | null;
  generatedAt: string | null;
};

// S14: a draft's AI-writing estimate, by document id.
export function getAiReport(documentId: number, conn: DatabaseSync = db()): AiReportView | null {
  const row = conn.prepare(`
    select d.id as documentId, d.title, d.text, d.bibliography_start as bibliographyStart, d.layout, a.status,
           a.unavailable_reason as unavailableReason, a.score, a.qualifying_words as qualifyingWords,
           a.segments, a.model, a.error, a.generated_at as generatedAt
      from ai_reports a join documents d on d.id = a.document_id
     where d.id = ?`).get(documentId) as
       (Omit<AiReportView, "segments" | "calibration" | "layout"> & { segments: string; model: string | null; layout: string | null }) | undefined;
  if (!row) return null;
  const { segments, model, layout, ...rest } = row;
  let calibration: AiCalibration | null = null;
  try {
    const parsed = JSON.parse(model ?? "");
    if (parsed && typeof parsed === "object") calibration = { ...parsed, calibrated: parsed.calibrated === true };
  } catch {}
  return { ...rest, layout: layout === null ? null : JSON.parse(layout), segments: JSON.parse(segments), calibration };
}

// Filters or exclusions changed: queue one rescore (repeats collapse). Only a finished report is
// rescored; one still being checked picks the change up when its similarity job scores. Call inside tx.
function requestRescore(reportId: number, conn: DatabaseSync) {
  const changed = conn.prepare(
    "update similarity_reports set status = 'recalculating' where id = ? and status in ('done', 'recalculating')",
  ).run(reportId).changes;
  if (Number(changed)) conn.prepare("insert into jobs (kind, report_id) values ('rescore', ?) on conflict do nothing").run(reportId);
}

// S11 Apply.
export function updateReportSettings(id: number, s: ReportSettings, conn: DatabaseSync = db()): { error?: string } {
  if (!Number.isInteger(s.smallMatchWords) || s.smallMatchWords < 0 || s.smallMatchWords > 1000) {
    return { error: "Use a whole number of words from 0 to 1000." };
  }
  tx(() => {
    conn.prepare("update similarity_reports set exclude_quotes = ?, exclude_bibliography = ?, small_match_words = ? where id = ?")
      .run(s.excludeQuotes ? 1 : 0, s.excludeBibliography ? 1 : 0, s.smallMatchWords, id);
    requestRescore(id, conn);
  }, conn);
  return {};
}

// S08 Exclude, S12 Restore. Only rows of this report.
export function setSourceExcluded(reportId: number, sourceId: number, excluded: boolean, conn: DatabaseSync = db()) {
  return flag("update report_sources set excluded = ? where report_id = ? and source_id = ?", reportId, sourceId, excluded, conn);
}

// S10 Exclude match, S12 Restore.
export function setMatchExcluded(reportId: number, matchId: number, excluded: boolean, conn: DatabaseSync = db()) {
  return flag("update matches set excluded = ? where report_id = ? and id = ?", reportId, matchId, excluded, conn);
}

function flag(sql: string, reportId: number, rowId: number, on: boolean, conn: DatabaseSync) {
  return tx(() => {
    const changed = Number(conn.prepare(sql).run(on ? 1 : 0, reportId, rowId).changes) > 0;
    if (changed) requestRescore(reportId, conn);
    return changed;
  }, conn);
}

// S07 failed state, S03 row: run the whole check again.
export function retryReport(id: number, conn: DatabaseSync = db()) {
  return tx(() => {
    const changed = Number(conn.prepare(
      "update similarity_reports set status = 'queued', error = null where id = ? and status = 'error'").run(id).changes) > 0;
    if (changed) conn.prepare("insert into jobs (kind, report_id) values ('similarity', ?) on conflict do nothing").run(id);
    return changed;
  }, conn);
}

// BEGIN IMMEDIATE takes the write lock up front, so the worker and the app never deadlock mid-transaction.
export function tx<T>(fn: () => T, conn: DatabaseSync = db()): T {
  conn.exec("begin immediate");
  try {
    const result = fn();
    conn.exec("commit");
    return result;
  } catch (e) {
    // No isTransaction on Node 22.14, so always try; it only fails if SQLite already rolled back itself.
    try {
      conn.exec("rollback");
    } catch {}
    throw e;
  }
}
