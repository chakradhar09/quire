"""Quire worker: claims jobs from the SQLite queue and runs them, one at a time.

    python main.py          migrate, then run jobs until Ctrl+C
    python main.py --once   run one job (if any) and exit

Settings come from the environment, or from worker/.env (see .env.example).
"""
import argparse
import contextlib
import hashlib
import json
import os
import pathlib
import shutil
import sys
import threading
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "db"))
import httpx2  # noqa: E402

import migrate  # noqa: E402
from ai import analyse  # noqa: E402
from align import align  # noqa: E402
from extract import Rejected, read_file  # noqa: E402
from references import Crossref, OpenAlex, lookup, split_references, title_of  # noqa: E402
from rescore import rescore  # noqa: E402
from search import BraveSearch, Fetcher, UnsafeUrl  # noqa: E402
from text import bibliography_start, in_quote, normalize, pick_queries, quote_spans, words  # noqa: E402

NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
MIN_WORDS = 20
IDLE_SECONDS = 2
# The pid file is touched this often while the worker runs. Older than STALE in web/lib/worker.ts and the
# launchers (120 s), it is left over from a worker that died (a crash, a reboot), and its process id may belong
# to another program by now.
HEARTBEAT_SECONDS = 15
CACHE_DAYS = 30
MIN_ABSTRACT_WORDS = 30  # shorter abstracts are a line of blurb, not text worth aligning against


def load_env(path):
    """KEY=VALUE lines into os.environ; real environment variables win."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep and not key.strip().startswith("#"):
            os.environ.setdefault(key.strip(), value.strip())


@contextlib.contextmanager
def tx(conn):
    conn.execute("begin immediate")
    try:
        yield
    except BaseException:
        conn.execute("rollback")
        raise
    conn.execute("commit")


def claim(conn, kinds):
    """Mark the oldest runnable job of these kinds as running and return it, or None."""
    marks = ", ".join("?" * len(kinds))
    with tx(conn):
        cur = conn.execute(f"""
            update jobs set status = 'running', locked_at = {NOW}, attempts = attempts + 1
             where id = (select id from jobs
                          where status = 'queued' and run_after <= {NOW} and kind in ({marks})
                          order by created_at, id limit 1)
            returning id, kind, document_id, report_id, attempts""", kinds)
        rows = cur.fetchall()  # finish the statement before COMMIT
    return dict(zip([c[0] for c in cur.description], rows[0])) if rows else None


def requeue_crashed(conn):
    """With one worker, anything still running at startup was cut off by a crash or Ctrl+C."""
    with tx(conn):
        n = conn.execute("update jobs set status = 'queued', locked_at = null where status = 'running'").rowcount
        conn.execute("update similarity_reports set status = 'queued' where status = 'processing'")
        conn.execute("update ai_reports set status = 'queued' where status = 'processing'")
    return n


def mark_failed(conn, job, message):
    message = message[:500]
    with tx(conn):
        conn.execute("update jobs set status = 'failed', error = ? where id = ?", (message, job["id"]))
        if job["report_id"]:
            conn.execute("update similarity_reports set status = 'error', error = ? where id = ?",
                         (message, job["report_id"]))
        if job["kind"] == "ai":
            conn.execute("update ai_reports set status = 'error', error = ? where document_id = ?",
                         (message, job["document_id"]))
        if job["kind"] == "extract":
            conn.execute("update documents set status = 'rejected', reject_reason = 'extraction_failed'"
                         " where id = ? and status = 'extracting'", (job["document_id"],))


def data_dir(conn):
    """Uploads live next to the database file (data/uploads/...), whichever database this is."""
    return pathlib.Path(conn.execute("pragma database_list").fetchone()[2]).parent


def save_layout(upload, layout):
    """Write a DOCX's pictures to media/ beside the upload, replacing an earlier read's, and return its blocks
    with each picture's file name as src; None when the file type has no layout."""
    media = upload.parent / "media"
    shutil.rmtree(media, ignore_errors=True)
    if not layout.get("blocks"):
        return None
    media.mkdir()
    for n, (ext, data) in enumerate(layout["pictures"], 1):
        (media / f"{n}.{ext}").write_bytes(data)
    return [{**b, "src": f"{b['n']}.{layout['pictures'][b['n'] - 1][0]}"} if b["t"] == "img" else b for b in layout["blocks"]]


def extract(conn, job):
    """An uploaded file or pasted text: read, normalize, count words, then reject or queue both checks."""
    doc_id = job["document_id"]
    raw, file_path = conn.execute("select text, file_path from documents where id = ?", (doc_id,)).fetchone()
    page_count, figures, layout = None, [], {}
    if file_path:
        try:
            raw, page_count = read_file(data_dir(conn) / file_path, figures=figures, layout=layout)
        except Rejected as r:
            with tx(conn):
                conn.execute("update documents set status = 'rejected', reject_reason = ? where id = ?", (r.reason, doc_id))
                conn.execute("update jobs set status = 'done', error = ? where id = ?", (str(r)[:500], job["id"]))
            return
    text = normalize(raw or "")
    blocks = save_layout(data_dir(conn) / file_path, layout) if file_path and text == raw else None
    count = len(words(text))
    with tx(conn):
        if count < MIN_WORDS:
            conn.execute("update documents set status = 'rejected', reject_reason = 'too_few_words',"
                         " text = ?, word_count = ?, page_count = ? where id = ?", (text, count, page_count, doc_id))
        else:
            digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
            conn.execute("update documents set status = 'ready', text = ?, word_count = ?, content_hash = ?, page_count = ?,"
                         " quote_spans = ?, bibliography_start = ?, layout = ? where id = ?",
                         (text, count, digest, page_count, json.dumps(quote_spans(text)), bibliography_start(text),
                          blocks and json.dumps(blocks), doc_id))
            conn.execute("insert into similarity_reports (document_id) values (?) on conflict do nothing", (doc_id,))
            conn.execute("insert into ai_reports (document_id) values (?) on conflict do nothing", (doc_id,))
            report_id = conn.execute("select id from similarity_reports where document_id = ?", (doc_id,)).fetchone()[0]
            conn.execute("insert into jobs (kind, report_id) values ('similarity', ?) on conflict do nothing", (report_id,))
            conn.execute("insert into jobs (kind, document_id) values ('ai', ?) on conflict do nothing", (doc_id,))
            conn.execute("delete from figures where document_id = ?", (doc_id,))
            conn.executemany("insert into figures (document_id, ordinal, hash) values (?, ?, ?)",
                             [(doc_id, i, h) for i, h in enumerate(figures, 1)])
        conn.execute("update jobs set status = 'done' where id = ?", (job["id"],))


def similarity(conn, job, search, fetch, budget, references=None):
    """Search the web for the draft's phrases, fetch what comes back, align, write the raw matches,
    then rescore. The reference list is not searched on the web: each entry's title is looked up with
    `references` (title -> work or None) instead, and a found work's abstract is aligned like a page.
    Every network call happens before the one write transaction opens."""
    report_id = job["report_id"]
    text, spans, bib = conn.execute(
        "select d.text, d.quote_spans, d.bibliography_start"
        " from similarity_reports r join documents d on d.id = r.document_id where r.id = ?", (report_id,)).fetchone()
    spans = json.loads(spans)
    with tx(conn):
        conn.execute("update similarity_reports set status = 'processing', error = null where id = ?", (report_id,))

    # The web searches come from the body: reference entries are short, split at every initial, and
    # are looked up by title below instead.
    queries = pick_queries(text if bib is None else text[:bib], budget)
    urls = []
    for query in queries:
        urls += [url for url in search(query) if url not in urls]

    def cached(url):
        return conn.execute(
            f"select id, title, text from sources where url = ? and fetched_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-{CACHE_DAYS} days')",
            (url,)).fetchone()

    pages = []  # (type, url, cached source id or None, title, text)
    for url in urls:
        if hit := cached(url):
            pages.append(("internet", url, *hit))
            continue
        try:
            page = fetch(url)
        except (UnsafeUrl, httpx2.HTTPError) as e:
            print(f"  skipped {url}: {e}")
            continue
        if page:
            pages.append(("internet", url, None, *page))

    checks = []  # (start, end, title, status, found title, found url, found year)
    for start, end in (split_references(text, bib) if references else []):
        title = title_of(text[start:end])
        work = references(title) if title else None
        status = "found" if work else ("not_found" if title else "no_title")
        checks.append((start, end, title, status, *((work["title"], work["url"], work["year"]) if work else (None, None, None))))
        if work and work["url"] and len(work["abstract"].split()) >= MIN_ABSTRACT_WORDS and work["url"] not in urls:
            urls.append(work["url"])
            hit = cached(work["url"])
            pages.append(("publication", work["url"], *(hit or (None, work["title"], normalize(work["abstract"])))))

    found = {i: m for i, page in enumerate(pages) if (m := align(text, page[4]))}

    with tx(conn):
        conn.execute("delete from matches where report_id = ?", (report_id,))
        conn.execute("delete from report_sources where report_id = ?", (report_id,))
        conn.execute("delete from reference_checks where report_id = ?", (report_id,))
        conn.executemany(
            'insert into reference_checks (report_id, start, "end", title, status, found_title, found_url, found_year)'
            " values (?, ?, ?, ?, ?, ?, ?, ?)", [(report_id, *c) for c in checks])
        source_ids = {}
        for i, (kind, url, source_id, title, page_text) in enumerate(pages):
            if source_id is None:
                digest = hashlib.sha256(page_text.encode("utf-8")).hexdigest()
                source_id = conn.execute(f"""
                    insert into sources (type, url, title, text, text_hash) values (?, ?, ?, ?, ?)
                    on conflict (url) where url is not null do update
                       set title = excluded.title, text = excluded.text, text_hash = excluded.text_hash, fetched_at = {NOW}
                    returning id""", (kind, url, title, page_text, digest)).fetchall()[0][0]
            source_ids[i] = source_id
        for i, ms in found.items():
            conn.execute("insert into report_sources (report_id, source_id) values (?, ?)", (report_id, source_ids[i]))
            conn.executemany(
                "insert into matches (report_id, source_id, doc_start, doc_end, src_start, src_end, word_count, match_group,"
                " in_quote, in_bibliography) values (?, ?, ?, ?, ?, ?, ?, 'not_cited_or_quoted', ?, ?)",
                [(report_id, source_ids[i], m.doc_start, m.doc_end, m.src_start, m.src_end, m.word_count,
                  in_quote(m.doc_start, m.doc_end, spans), bib is not None and m.doc_start >= bib) for m in ms])
        rescore(conn, report_id)
        conn.execute(f"update similarity_reports set queries_used = ?, generated_at = {NOW}, error = null where id = ?",
                     (len(queries), report_id))
        conn.execute("update jobs set status = 'done' where id = ?", (job["id"],))


_web = {}  # one Brave client and one fetcher per worker run, so rate limits and robots.txt carry over


def brave_key(settings_file=None):
    """The Brave Search key: the one saved on the Settings page (data/settings.json), else BRAVE_API_KEY from the
    environment or worker/.env. Read for every check, so a key saved while the worker runs is used by the next one."""
    try:
        path = settings_file or migrate.default_path().parent / "settings.json"
        saved = str(json.loads(pathlib.Path(path).read_text(encoding="utf-8")).get("braveApiKey") or "").strip()
    except (OSError, ValueError):
        saved = ""
    return saved or os.environ.get("BRAVE_API_KEY", "")


def similarity_from_env(conn, job):
    key = brave_key()
    if _web.get("key") != key:
        _web.update(key=key, search=BraveSearch(key), fetch=Fetcher(contact=os.environ.get("UA_CONTACT", "")).fetch)
    if "references" not in _web:
        client = httpx2.Client(timeout=20)
        catalogues = [OpenAlex(client), Crossref(client)]
        # REFERENCE_LOOKUP=off: the reference list's titles are not sent anywhere (README, Privacy).
        _web["references"] = None if os.environ.get("REFERENCE_LOOKUP") == "off" else (lambda title: lookup(title, catalogues))
    similarity(conn, job, _web["search"], _web["fetch"], int(os.environ.get("SEARCH_QUERY_BUDGET") or 40),
               references=_web["references"])


def ai_job(conn, job, scorer, threshold, model):
    """The AI-writing estimate. The scorer (a model on the GPU) runs before the write transaction opens."""
    doc_id = job["document_id"]
    text, bib = conn.execute("select text, bibliography_start from documents where id = ?", (doc_id,)).fetchone()
    with tx(conn):
        conn.execute("update ai_reports set status = 'processing', error = null where document_id = ?", (doc_id,))
    r = analyse(text, bib, scorer, threshold)
    model = model() if callable(model) else model  # a description can depend on how the models loaded
    with tx(conn):
        conn.execute(f"""update ai_reports set status = ?, unavailable_reason = ?, score = ?, qualifying_words = ?,
                         segments = ?, model = ?, generated_at = {NOW}, error = null where document_id = ?""",
                     (r.status, r.reason, r.score, r.qualifying_words, json.dumps(r.segments), model, doc_id))
        conn.execute("update jobs set status = 'done' where id = ?", (job["id"],))


def rescore_job(conn, job):
    """Filters or exclusions changed: no network, just the scoring path again."""
    with tx(conn):
        rescore(conn, job["report_id"])
        conn.execute("update jobs set status = 'done' where id = ?", (job["id"],))


_ai = {}  # one detector per worker run; it loads its model on the first window it scores


def detector_from_env():
    """AI_DETECTOR: "classifier" or "binoculars". Unset, the trained classifier when there is one (T13 follow-up)."""
    import classifier  # neither import loads torch; the model loads on the first window
    choice = (os.environ.get("AI_DETECTOR") or "").strip().lower() or ("classifier" if classifier.trained() else "binoculars")
    if choice == "classifier":
        return classifier.Classifier()
    if choice == "binoculars":
        from binoculars import Binoculars
        return Binoculars()
    raise ValueError(f"AI_DETECTOR is {choice!r}; use classifier or binoculars")


def ai_from_env(conn, job):
    if not _ai:
        _ai["scorer"] = detector_from_env()
    scorer = _ai["scorer"]
    ai_job(conn, job, scorer, scorer.threshold, scorer.describe)


# Only kinds listed here are claimed.
HANDLERS = {"extract": extract, "similarity": similarity_from_env, "rescore": rescore_job, "ai": ai_from_env}


def run(conn, job):
    """Run one claimed job. A failure is recorded on the job and its report, never raised."""
    try:
        HANDLERS[job["kind"]](conn, job)
        return True
    except Exception as e:
        if conn.in_transaction:
            conn.execute("rollback")
        mark_failed(conn, job, f"{type(e).__name__}: {e}")
        return False


def keep_fresh(pid_file, pid):
    """Touch the pid file every HEARTBEAT_SECONDS for as long as it names this worker (a daemon thread)."""
    while True:
        time.sleep(HEARTBEAT_SECONDS)
        with contextlib.suppress(OSError):
            if pid_file.read_text(encoding="utf-8").strip() == pid:
                os.utime(pid_file)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Quire worker")
    parser.add_argument("--once", action="store_true", help="run one job, then exit")
    parser.add_argument("--idle-exit", type=float, metavar="SECONDS",
                        help="exit once the queue has been empty this long (the web app starts the worker with 300)")
    args = parser.parse_args(argv)

    load_env(HERE / ".env")
    print(f"database {migrate.default_path()} at version {migrate.migrate()}")
    conn = migrate.connect()
    if n := requeue_crashed(conn):
        print(f"requeued {n} job(s) left running by the last run")
    # While this file names a live process, the web app does not start another worker (web/lib/worker.ts).
    pid_file = migrate.default_path().parent / "worker.pid"
    pid_file.write_text(str(os.getpid()), encoding="utf-8")
    threading.Thread(target=keep_fresh, args=(pid_file, str(os.getpid())), daemon=True).start()
    last_job = time.monotonic()
    try:
        while True:
            job = claim(conn, list(HANDLERS))
            if job is None:
                if args.once:
                    print("no queued job")
                    return 0
                if args.idle_exit is not None and time.monotonic() - last_job > args.idle_exit:
                    print(f"queue empty for {args.idle_exit:.0f} s, stopping")
                    return 0
                time.sleep(IDLE_SECONDS)
                continue
            ok = run(conn, job)
            last_job = time.monotonic()
            target = f"document {job['document_id']}" if job["document_id"] else f"report {job['report_id']}"
            print(f"job {job['id']} {job['kind']} ({target}): {'done' if ok else 'failed'}", flush=True)
            if args.once:
                return 0 if ok else 1
    finally:
        with contextlib.suppress(OSError):
            if pid_file.read_text(encoding="utf-8").strip() == str(os.getpid()):
                pid_file.unlink()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("stopped")
