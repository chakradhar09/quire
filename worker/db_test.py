"""Database checks: the schema and the worker's writes, on a temporary file migrated by the
real runner. Run from worker/:

    python -m unittest discover -p "*_test.py"
"""
import json
import pathlib
import sqlite3
import sys
import os
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "db"))
import migrate  # noqa: E402
import main  # noqa: E402
from search import UnsafeUrl, extract  # noqa: E402
from text import words  # noqa: E402
from extract_test import make_pdf  # noqa: E402

TABLES = ["ai_reports", "documents", "figures", "fingerprints", "integrity_flags", "jobs",
          "matches", "report_sources", "resolutions", "similarity_reports", "sources"]
# The newest migration's number, read from the folder so a new migration does not break these tests.
NEWEST = max(int(f.name[:3]) for f in migrate.MIGRATIONS.glob("*.sql"))

FIFTY_WORDS = " ".join(["coral"] * 50)
FIXTURE = (pathlib.Path(__file__).parent / "fixtures" / "article_page.html").read_text(encoding="utf-8")
# The fixture's first paragraph, copied into a draft between two sentences of its own.
COPIED = ("Mangrove forests grow along tropical coastlines where salt water meets fresh water. "
          "Their tangled roots slow the tide, trap sediment and shelter young fish, crabs and shrimp. "
          "When storms arrive, a wide belt of mangroves can absorb much of the energy of the waves "
          "before they reach the shore.")
DRAFT = ("I chose coastal forests for this essay because my family lives close to a large estuary in the south. "
         + COPIED + " In the end I think we should protect these places before more of them are lost to new building projects.")


class TempDatabase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(tmp.cleanup)
        self.path = pathlib.Path(tmp.name) / "data" / "quire.db"
        migrate.migrate(self.path)
        self.conn = migrate.connect(self.path)
        self.addCleanup(self.conn.close)

    def add_document(self, title="Draft", **cols):
        names = ["title", *cols]
        sql = f"insert into documents ({', '.join(names)}) values ({', '.join('?' * len(names))}) returning id"
        return self.conn.execute(sql, [title, *cols.values()]).fetchone()[0]

    def count(self, table):
        return self.conn.execute(f"select count(*) from {table}").fetchone()[0]


class DatabaseTest(TempDatabase):
    def test_migrate_creates_the_folder_and_all_tables_at_the_newest_version(self):
        tables = [r[0] for r in self.conn.execute(
            "select name from sqlite_master where type = 'table' order by name")]
        self.assertEqual(tables, TABLES)
        self.assertEqual(self.conn.execute("pragma user_version").fetchone()[0], NEWEST)

    def test_migrating_again_changes_nothing(self):
        self.add_document()
        self.assertEqual(migrate.migrate(self.path), NEWEST)
        self.assertEqual(self.count("documents"), 1)

    def test_a_failing_migration_leaves_the_database_as_it_was(self):
        broken = pathlib.Path(self.path.parent / "migrations")
        broken.mkdir()
        for f in migrate.MIGRATIONS.glob("*.sql"):
            (broken / f.name).write_text(f.read_text(encoding="utf-8"), encoding="utf-8")
        (broken / f"{NEWEST + 1:03d}_broken.sql").write_text(
            "create table half_done (id integer primary key);\ninsert into no_such_table values (1);\n", encoding="utf-8")
        self.addCleanup(setattr, migrate, "MIGRATIONS", migrate.MIGRATIONS)
        migrate.MIGRATIONS = broken

        with self.assertRaisesRegex(RuntimeError, f"{NEWEST + 1:03d}_broken.sql"):
            migrate.migrate(self.path)

        self.assertEqual(self.conn.execute("pragma user_version").fetchone()[0], NEWEST)
        self.assertIsNone(self.conn.execute(
            "select name from sqlite_master where name = 'half_done'").fetchone())

    def test_connect_turns_on_foreign_keys_wal_and_busy_timeout(self):
        self.assertEqual(self.conn.execute("pragma foreign_keys").fetchone()[0], 1)
        self.assertEqual(self.conn.execute("pragma journal_mode").fetchone()[0], "wal")
        self.assertEqual(self.conn.execute("pragma busy_timeout").fetchone()[0], 5000)

    def test_connect_never_opens_a_transaction_on_its_own(self):
        self.add_document()
        self.assertFalse(self.conn.in_transaction)

    def test_a_rejected_document_needs_a_reason(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.add_document(status="rejected")
        self.add_document(status="rejected", reject_reason="too_few_words")

    def test_two_queued_extract_jobs_for_one_document_collapse_to_one(self):
        doc = self.add_document()
        for _ in range(2):
            self.conn.execute(
                "insert into jobs (kind, document_id) values ('extract', ?) on conflict do nothing", (doc,))
        self.assertEqual(self.count("jobs"), 1)

    def test_deleting_a_document_removes_what_hangs_off_it_and_keeps_newer_versions(self):
        doc = self.add_document()
        newer = self.add_document(title="Draft v2", parent_id=doc)
        report = self.conn.execute(
            "insert into similarity_reports (document_id) values (?) returning id", (doc,)).fetchone()[0]
        self.conn.execute("insert into ai_reports (document_id) values (?)", (doc,))
        source = self.conn.execute(
            "insert into sources (type, url, text, text_hash) values ('internet', 'https://example.org', 't', 'h') returning id"
        ).fetchone()[0]
        self.conn.execute("insert into report_sources (report_id, source_id) values (?, ?)", (report, source))
        self.conn.execute(
            "insert into matches (report_id, source_id, doc_start, doc_end, src_start, src_end, word_count, match_group)"
            " values (?, ?, 0, 40, 0, 40, 8, 'not_cited_or_quoted')", (report, source))
        self.conn.execute("insert into jobs (kind, report_id) values ('similarity', ?)", (report,))
        self.conn.execute("insert into jobs (kind, document_id) values ('ai', ?)", (doc,))

        self.conn.execute("delete from documents where id = ?", (doc,))

        for table in ("similarity_reports", "ai_reports", "report_sources", "matches", "jobs"):
            self.assertEqual(self.count(table), 0, table)
        self.assertEqual(self.count("sources"), 1, "a web source outlives the drafts that matched it")
        parent = self.conn.execute("select parent_id from documents where id = ?", (newer,)).fetchone()[0]
        self.assertIsNone(parent)


class WorkerTest(TempDatabase):
    def add_job(self, kind, **target):
        (col, value), = target.items()
        return self.conn.execute(f"insert into jobs (kind, {col}) values (?, ?) returning id", (kind, value)).fetchone()[0]

    def job(self, job_id):
        return self.conn.execute("select status, attempts, error from jobs where id = ?", (job_id,)).fetchone()

    def test_claim_takes_the_oldest_queued_job_of_the_given_kinds(self):
        doc = self.add_document()
        self.add_job("ai", document_id=doc)
        older = self.add_job("extract", document_id=doc)
        self.conn.execute("update jobs set status = 'done' where id = ?", (older,))
        wanted = self.add_job("extract", document_id=doc)

        job = main.claim(self.conn, ["extract"])

        self.assertEqual((job["id"], job["kind"], job["document_id"]), (wanted, "extract", doc))
        self.assertEqual(self.job(wanted)[:2], ("running", 1))
        self.assertIsNone(main.claim(self.conn, ["extract"]), "nothing else is claimable")
        self.assertFalse(self.conn.in_transaction)

    def test_claim_waits_for_run_after(self):
        doc = self.add_document()
        later = self.add_job("extract", document_id=doc)
        self.conn.execute("update jobs set run_after = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour') where id = ?", (later,))
        self.assertIsNone(main.claim(self.conn, ["extract"]))

    def test_requeue_crashed_puts_running_work_back_in_the_queue(self):
        doc = self.add_document(status="ready")
        report = self.conn.execute(
            "insert into similarity_reports (document_id, status) values (?, 'processing') returning id", (doc,)).fetchone()[0]
        job = self.add_job("similarity", report_id=report)
        self.conn.execute("update jobs set status = 'running' where id = ?", (job,))

        self.assertEqual(main.requeue_crashed(self.conn), 1)

        self.assertEqual(self.job(job)[0], "queued")
        status = self.conn.execute("select status from similarity_reports where id = ?", (report,)).fetchone()[0]
        self.assertEqual(status, "queued")

    def test_a_failing_report_job_is_marked_failed_with_its_report_in_error(self):
        doc = self.add_document(status="ready")
        report = self.conn.execute("insert into similarity_reports (document_id) values (?) returning id", (doc,)).fetchone()[0]
        self.add_job("similarity", report_id=report)

        def boom(conn, job):
            conn.execute("begin immediate")  # left open on purpose: run() must roll it back
            raise ValueError("Brave rate limit, try again in a minute")

        with mock.patch.dict(main.HANDLERS, similarity=boom):
            job = main.claim(self.conn, ["similarity"])
            self.assertFalse(main.run(self.conn, job))

        status, _, error = self.job(job["id"])
        self.assertEqual(status, "failed")
        self.assertIn("Brave rate limit", error)
        row = self.conn.execute("select status, error from similarity_reports where id = ?", (report,)).fetchone()
        self.assertEqual(row[0], "error")
        self.assertIn("Brave rate limit", row[1])
        self.assertFalse(self.conn.in_transaction)

    def test_a_failing_extract_rejects_the_draft_instead_of_leaving_it_stuck(self):
        doc = self.add_document(text=FIFTY_WORDS)
        self.add_job("extract", document_id=doc)
        with mock.patch.dict(main.HANDLERS, extract=lambda conn, job: 1 / 0):
            main.run(self.conn, main.claim(self.conn, ["extract"]))

        row = self.conn.execute("select status, reject_reason from documents where id = ?", (doc,)).fetchone()
        self.assertEqual(row, ("rejected", "extraction_failed"))

    def test_extract_rejects_a_draft_under_20_words(self):
        doc = self.add_document(text="Only a few words here.")
        job = self.add_job("extract", document_id=doc)

        self.assertTrue(main.run(self.conn, main.claim(self.conn, ["extract"])))

        row = self.conn.execute("select status, reject_reason, word_count from documents where id = ?", (doc,)).fetchone()
        self.assertEqual(row, ("rejected", "too_few_words", 5))
        self.assertEqual(self.job(job)[0], "done")
        self.assertEqual(self.count("similarity_reports"), 0)

    def test_extract_stores_normalized_text_and_queues_both_checks(self):
        doc = self.add_document(text="First\r\nline " + FIFTY_WORDS + "\u200b")
        job = self.add_job("extract", document_id=doc)

        self.assertTrue(main.run(self.conn, main.claim(self.conn, ["extract"])))

        status, text, word_count, content_hash = self.conn.execute(
            "select status, text, word_count, content_hash from documents where id = ?", (doc,)).fetchone()
        self.assertEqual(status, "ready")
        self.assertEqual(text, "First\nline " + FIFTY_WORDS)
        self.assertEqual(word_count, 52)
        self.assertEqual(len(content_hash), 64)
        self.assertEqual(self.job(job)[0], "done")
        report = self.conn.execute("select id from similarity_reports where document_id = ?", (doc,)).fetchone()[0]
        self.assertEqual(self.count("ai_reports"), 1)
        queued = self.conn.execute(
            "select kind, document_id, report_id from jobs where status = 'queued' order by kind").fetchall()
        self.assertEqual(queued, [("ai", doc, None), ("similarity", None, report)])


class UploadExtractTest(TempDatabase):
    def upload(self, name, data):
        doc = self.add_document(title=name, filename=name, file_path="pending")
        relative = f"uploads/{doc}/original{pathlib.Path(name).suffix}"
        (self.path.parent / relative).parent.mkdir(parents=True, exist_ok=True)
        (self.path.parent / relative).write_bytes(data)
        self.conn.execute("update documents set file_path = ? where id = ?", (relative, doc))
        job = self.conn.execute("insert into jobs (kind, document_id) values ('extract', ?) returning id", (doc,)).fetchone()[0]
        self.assertTrue(main.run(self.conn, main.claim(self.conn, ["extract"])))
        return doc, job

    def test_an_uploaded_file_is_read_from_disk_and_checked(self):
        doc, _ = self.upload("essay.txt", ("First\r\nline " + FIFTY_WORDS).encode("utf-8"))
        row = self.conn.execute("select status, text, word_count, page_count from documents where id = ?", (doc,)).fetchone()
        self.assertEqual(row, ("ready", "First\nline " + FIFTY_WORDS, 52, None))
        self.assertEqual(self.count("similarity_reports"), 1)

    def test_a_pdf_records_its_page_count(self):
        doc, _ = self.upload("essay.pdf", make_pdf([[FIFTY_WORDS[:80]] * 3, ["second page with a few more words in it"]]))
        status, pages = self.conn.execute("select status, page_count from documents where id = ?", (doc,)).fetchone()
        self.assertEqual((status, pages), ("ready", 2))

    def test_a_docx_stores_a_hash_for_each_picture_big_enough_to_read(self):
        import io
        from unittest import mock
        import docx
        from PIL import Image
        d = docx.Document()
        d.add_paragraph(FIFTY_WORDS)
        for size, inches in (((600, 300), 4), ((32, 32), 0.3), ((500, 500), 2)):
            buf = io.BytesIO()
            Image.new("RGB", size, "white").save(buf, "PNG")
            buf.seek(0)
            d.add_picture(buf, width=docx.shared.Inches(inches))
        buf = io.BytesIO()
        d.save(buf)
        with mock.patch("extract._ocr", return_value=[]):
            doc, _ = self.upload("figures.docx", buf.getvalue())
        rows = self.conn.execute("select ordinal, length(hash) from figures where document_id = ? order by ordinal", (doc,)).fetchall()
        self.assertEqual(rows, [(1, 16), (2, 16)])  # the 0.3-inch icon is skipped

    def test_a_docx_keeps_its_layout_and_pictures_for_the_viewer(self):
        import io
        from unittest import mock
        import docx
        from PIL import Image
        d = docx.Document()
        d.add_heading("Coral", level=1)
        d.add_paragraph(FIFTY_WORDS)
        picture = io.BytesIO()
        Image.new("RGB", (300, 200), "white").save(picture, "PNG")
        d.add_picture(io.BytesIO(picture.getvalue()), width=docx.shared.Inches(3))
        buf = io.BytesIO()
        d.save(buf)
        stale = self.path.parent / "uploads" / "1" / "media"
        stale.mkdir(parents=True)
        (stale / "9.png").write_bytes(b"from an earlier read")
        with mock.patch("extract._ocr", return_value=[]):
            doc, _ = self.upload("coral.docx", buf.getvalue())
        self.assertEqual(doc, 1)
        text, layout = self.conn.execute("select text, layout from documents where id = ?", (doc,)).fetchone()
        blocks = json.loads(layout)
        self.assertEqual([b["t"] for b in blocks], ["h1", "p", "img"])
        self.assertEqual(text[slice(*blocks[0]["r"])], "Coral")
        media = self.path.parent / "uploads" / "1" / "media"
        self.assertEqual(blocks[2]["src"], "1.png")
        self.assertEqual(sorted(p.name for p in media.iterdir()), ["1.png"])  # an earlier read's pictures go
        self.assertEqual((media / "1.png").read_bytes(), picture.getvalue())

    def test_pasted_text_has_no_layout(self):
        doc, _ = self.upload("essay.txt", FIFTY_WORDS.encode("utf-8"))
        self.assertIsNone(self.conn.execute("select layout from documents where id = ?", (doc,)).fetchone()[0])

    def test_an_image_only_pdf_is_rejected_with_its_reason_and_the_detail_on_the_job(self):
        doc, job = self.upload("scan.pdf", make_pdf([[]]))
        row = self.conn.execute("select status, reject_reason from documents where id = ?", (doc,)).fetchone()
        self.assertEqual(row, ("rejected", "image_only_pdf"))
        status, error = self.conn.execute("select status, error from jobs where id = ?", (job,)).fetchone()
        self.assertEqual(status, "done")
        self.assertIn("no selectable text", error)
        self.assertEqual(self.count("similarity_reports"), 0)


class SimilarityJobTest(TempDatabase):
    def queue_check(self):
        doc = self.add_document(status="ready", text=DRAFT, word_count=len(words(DRAFT)))
        report = self.conn.execute("insert into similarity_reports (document_id) values (?) returning id", (doc,)).fetchone()[0]
        self.conn.execute("insert into jobs (kind, report_id) values ('similarity', ?)", (report,))
        return report, main.claim(self.conn, ["similarity"])

    def fakes(self, results):
        calls = {"search": [], "fetch": []}

        def search(query):
            calls["search"].append(query)
            return results

        def fetch(url):
            self.assertFalse(self.conn.in_transaction, "no transaction may be open during network calls")
            calls["fetch"].append(url)
            if "unsafe" in url:
                raise UnsafeUrl("resolves to a non-public address")
            if "coastal" in url:
                return extract(FIXTURE)
            return "Volcanoes", "Lava flows downhill from the crater while ash clouds rise high into the sky above."
        return search, fetch, calls

    def test_finds_the_copied_paragraph_and_scores_exactly_its_share(self):
        report, job = self.queue_check()
        search, fetch, calls = self.fakes(["https://coastal.example/mangroves", "https://other.example/volcanoes"])

        main.similarity(self.conn, job, search=search, fetch=fetch, budget=3)

        status, score, queries_used = self.conn.execute(
            "select status, score, queries_used from similarity_reports where id = ?", (report,)).fetchone()
        self.assertEqual(status, "done")
        self.assertEqual(score, round(100 * len(words(COPIED)) / len(words(DRAFT)), 2))
        self.assertEqual(queries_used, len(calls["search"]))
        self.assertLessEqual(queries_used, 3)
        (doc_start, doc_end, match_words), = self.conn.execute(
            "select doc_start, doc_end, word_count from matches where report_id = ?", (report,)).fetchall()
        self.assertEqual(DRAFT[doc_start:doc_end], COPIED[:-1])
        self.assertEqual(match_words, len(words(COPIED)))
        ranked = self.conn.execute(
            "select s.url, rs.rank, rs.percent from report_sources rs join sources s on s.id = rs.source_id"
            " where rs.report_id = ?", (report,)).fetchall()
        self.assertEqual(ranked, [("https://coastal.example/mangroves", 1, score)])
        self.assertEqual(self.count("sources"), 2, "both fetched pages are cached, matching or not")
        self.assertEqual(self.job(job["id"]), "done")

    def test_a_rerun_replaces_the_results_and_reuses_cached_pages(self):
        report, job = self.queue_check()
        search, fetch, calls = self.fakes(["https://coastal.example/mangroves"])
        main.similarity(self.conn, job, search=search, fetch=fetch, budget=3)
        main.similarity(self.conn, job, search=search, fetch=fetch, budget=3)

        self.assertEqual(self.count("matches"), 1)
        self.assertEqual(self.count("report_sources"), 1)
        self.assertEqual(self.count("sources"), 1)
        self.assertEqual(calls["fetch"], ["https://coastal.example/mangroves"], "the second run used the cache")

    def test_an_unsafe_or_broken_result_is_skipped_not_fatal(self):
        report, job = self.queue_check()
        search, fetch, _ = self.fakes(["http://unsafe.example/", "https://coastal.example/mangroves"])
        main.similarity(self.conn, job, search=search, fetch=fetch, budget=1)
        status, = self.conn.execute("select status from similarity_reports where id = ?", (report,)).fetchone()
        self.assertEqual(status, "done")
        self.assertEqual(self.count("sources"), 1)

    def test_flags_matches_inside_quotes_and_in_the_reference_list(self):
        intro = "I chose coastal forests for this essay because my family lives close to a large estuary in the south. "
        draft = (intro + 'One field guide puts it plainly: "' + COPIED + '" We should protect these places.\n'
                 "References\n" + COPIED + "\n")
        doc = self.add_document(text=draft)
        self.conn.execute("insert into jobs (kind, document_id) values ('extract', ?)", (doc,))
        self.assertTrue(main.run(self.conn, main.claim(self.conn, ["extract"])))

        spans, bib = self.conn.execute("select quote_spans, bibliography_start from documents where id = ?", (doc,)).fetchone()
        quote_open = len(intro) + len("One field guide puts it plainly: ")
        self.assertEqual(json.loads(spans), [[quote_open, quote_open + len(COPIED) + 2]])
        self.assertEqual(bib, draft.index("References"))

        search, fetch, _ = self.fakes(["https://coastal.example/mangroves"])
        main.similarity(self.conn, main.claim(self.conn, ["similarity"]), search=search, fetch=fetch, budget=1)
        flags = self.conn.execute("select in_quote, in_bibliography from matches order by doc_start").fetchall()
        self.assertEqual(flags, [(1, 0), (0, 1)])

    def test_the_rescore_job_gives_what_the_similarity_job_gave_for_the_same_settings(self):
        report, job = self.queue_check()
        search, fetch, _ = self.fakes(["https://coastal.example/mangroves", "https://other.example/volcanoes"])
        main.similarity(self.conn, job, search=search, fetch=fetch, budget=3)

        def snapshot():
            return (self.conn.execute("select status, score from similarity_reports where id = ?", (report,)).fetchone(),
                    self.conn.execute("select source_id, rank, percent, matched_words from report_sources order by source_id").fetchall(),
                    self.conn.execute("select id, hidden_reason from matches order by id").fetchall())
        before = snapshot()
        self.conn.execute("update similarity_reports set status = 'recalculating' where id = ?", (report,))
        rescore_job = self.conn.execute("insert into jobs (kind, report_id) values ('rescore', ?) returning id", (report,)).fetchone()[0]
        self.assertTrue(main.run(self.conn, main.claim(self.conn, list(main.HANDLERS))))

        self.assertEqual(snapshot(), before)
        self.assertEqual(self.job(rescore_job), "done")

        self.conn.execute("update report_sources set excluded = 1")
        self.conn.execute("insert into jobs (kind, report_id) values ('rescore', ?)", (report,))
        self.assertTrue(main.run(self.conn, main.claim(self.conn, ["rescore"])))
        self.assertEqual(self.conn.execute("select score from similarity_reports").fetchone(), (0.0,))

    def test_no_api_key_fails_the_check_with_where_to_put_it(self):
        report, job = self.queue_check()
        with mock.patch.dict(os.environ, {"BRAVE_API_KEY": ""}):
            self.assertFalse(main.run(self.conn, job))
        status, error = self.conn.execute("select status, error from similarity_reports where id = ?", (report,)).fetchone()
        self.assertEqual(status, "error")
        self.assertIn("Settings page", error)

    def job(self, job_id):
        return self.conn.execute("select status from jobs where id = ?", (job_id,)).fetchone()[0]


class AiJobTest(TempDatabase):
    PROSE = " ".join(f"Sentence {i} describes how the river shapes the lives of people beside it today." for i in range(30))

    def queue(self, text):
        doc = self.add_document(status="ready", text=text, word_count=len(words(text)))
        self.conn.execute("insert into ai_reports (document_id) values (?)", (doc,))
        self.conn.execute("insert into jobs (kind, document_id) values ('ai', ?)", (doc,))
        return doc, main.claim(self.conn, ["ai"])

    def report(self, doc):
        cur = self.conn.execute("select status, unavailable_reason, score, qualifying_words, segments, model, error,"
                                " generated_at is not null from ai_reports where document_id = ?", (doc,))
        return dict(zip([c[0] for c in cur.description], cur.fetchone()))

    def test_writes_the_score_segments_and_model_then_finishes_the_job(self):
        doc, job = self.queue(self.PROSE)
        seen = []

        def scorer(texts):
            seen.append(self.conn.in_transaction)
            return [0.5] + [1.0] * (len(texts) - 1)
        main.ai_job(self.conn, job, scorer, threshold=0.9, model="stand-in")

        r = self.report(doc)
        self.assertEqual(seen, [False], "the model runs with no transaction open")
        self.assertEqual((r["status"], r["qualifying_words"], r["model"], r["error"]), ("done", 420, "stand-in", None))
        self.assertEqual(r["score"], 33.33, "one of three 140-word windows")
        self.assertEqual([s["label"] for s in json.loads(r["segments"])], ["ai"])
        self.assertTrue(r["generated_at is not null"])
        self.assertEqual(self.conn.execute("select status from jobs where id = ?", (job["id"],)).fetchone(), ("done",))

    def test_a_short_draft_is_unavailable_with_its_reason(self):
        doc, job = self.queue("Only one sentence of prose is not nearly enough for this.")
        main.ai_job(self.conn, job, lambda texts: [], threshold=0.9, model="stand-in")
        r = self.report(doc)
        self.assertEqual((r["status"], r["unavailable_reason"], r["score"]), ("unavailable", "too_few_words", None))

    def test_a_failing_ai_job_marks_its_report_failed(self):
        doc, job = self.queue(self.PROSE)

        def boom(texts):
            raise RuntimeError("CUDA out of memory")
        with mock.patch.dict(main.HANDLERS, {"ai": lambda conn, j: main.ai_job(conn, j, boom, 0.9, "x")}):
            self.assertFalse(main.run(self.conn, job))
        r = self.report(doc)
        self.assertEqual(r["status"], "error")
        self.assertIn("CUDA out of memory", r["error"])

    def test_requeue_crashed_puts_an_interrupted_ai_report_back_in_the_queue(self):
        doc, _ = self.queue(self.PROSE)
        self.conn.execute("update ai_reports set status = 'processing'")
        main.requeue_crashed(self.conn)
        self.assertEqual(self.report(doc)["status"], "queued")


if __name__ == "__main__":
    unittest.main()
