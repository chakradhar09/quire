# Milestone 1 todo: the vertical slice

Plan and decisions: `tasks/plan.md`. `web/` is the Next app; `db/`, `worker/` and `data/` (git-ignored) are at the project root, all in one git repository. Built in the main session; no subagents.
Web checks = from `web/`: `npx tsc --noEmit`, `npx eslint`, `npm test`, `npm run build`.
Worker checks = from `worker/`: `.venv\Scripts\python -m unittest discover -p "*_test.py"` (the venv is needed from T7 on: the worker imports httpx).
Times are written only by SQL `strftime('%Y-%m-%dT%H:%M:%fZ','now')`; every connection runs the three pragmas.

## Phase 1: Foundation

- [x] **T1: Database and migration runner**
  - Copy `replica/schema.sql` verbatim to `db/migrations/001_init.sql`.
  - `db/migrate.py` (stdlib): `migrate(path)` and CLI `python db/migrate.py [path]`; pragmas on open; reads `user_version`; applies each higher-numbered `NNN_*.sql` in its own transaction and sets `user_version`; creates `data/`; a second run does nothing.
  - Root `.gitignore`: `data/`, `worker/.env`, `worker/.venv/`.
  - `worker/db_test.py` (temp file, real `migrate.py`): migrating twice leaves `user_version = 1` and nine tables; `foreign_keys` is 1; a rejected document without a reason fails; two queued `extract` inserts with `ON CONFLICT DO NOTHING` leave one job; deleting a document cascades to its reports, matches, report_sources and jobs, and sets `parent_id` null on its newer version.
  - Run `python db/migrate.py` once to create `data/draftcheck.db`.
  - Acceptance: the tests pass; the database file exists at version 1.
  - Files: `db/migrations/001_init.sql`, `db/migrate.py`, `.gitignore`, `worker/db_test.py`.

- [x] **T2: Web database layer and loopback lock (proves `node:sqlite` under Next)**
  - `web/lib/db.ts`: lazy `db()` cached on `globalThis`, pragmas on open, `user_version` check with the "run `python db/migrate.py`" error, `DATABASE_PATH` default `../data/draftcheck.db`, `tx(fn)`.
  - `web/app/page.tsx`: temporary stub with a static heading and, behind `<Suspense>`, an async child that calls `await connection()` and shows `select count(*) from documents` (replaced in T3).
  - `web/proxy.ts`: 403 unless `Host` is `localhost:3000`, `127.0.0.1:3000` or `[::1]:3000`; missing Host is 403; matcher covers every path.
  - `web/package.json`: `dev` and `start` with `-H 127.0.0.1`. `.claude/launch.json` `web` gets `"url": "http://127.0.0.1:3000"`.
  - Acceptance: the stub shows the live count under `npm run dev`, and a row inserted with `python -c` appears on reload; `npm run build` passes; a wrong `user_version` shows the migrate message; the curl check gives 403 for a foreign Host and 200 without it. If `node:sqlite` fails to bundle or run, switch to `better-sqlite3` and say so.
  - Files: `web/lib/db.ts`, `web/lib/db.test.ts`, `web/app/page.tsx`, `web/proxy.ts`, `web/package.json` (also `@types/node` pinned to 22.14 to match the runtime), `.claude/launch.json`.

### Checkpoint CP1
- [x] Worker and web checks pass; the DB is read per request; the Host check works. Review with you before Phase 2.

## Phase 2: The queue

- [x] **T3: Paste and list (S04 paste only, S03; F01; rows "Paste text as a submission", "Submissions list" partial)**
  - `db.ts` `submitText(title, text)`: one transaction inserts the document (`extracting`, raw text) and its `extract` job; returns the id.
  - `web/app/actions.ts` `submitText`: title trimmed, 1 to 300 characters; text non-empty and at most 2 MB of UTF-8; on failure re-render S04 with the message; on success redirect `/`. `next.config.ts`: `experimental.serverActions.bodySizeLimit: '3mb'`.
  - `web/app/submit/page.tsx` (S04): title `TextField`, `TextArea`, `Button`, `InlineAlert`.
  - `web/app/page.tsx` (S03): `AppHeader`, `EmptyState` linking `/submit`, `DraftsTable` from `documents` + `similarity_reports`, newest first, behind `<Suspense>` with `await connection()`. `extracting` shows the `processing` pill, `rejected` the `rejected` pill plus its reason; similarity badge `pending` until `done`; AI badge `pending`.
  - Acceptance: a paste creates one `extracting` document and one queued `extract` job; the row shows on S03; a 3 MB paste and an empty title are refused with a message.
  - Verify: web checks; manual paste, then `select * from jobs` with `python -c`.
  - Files: `web/lib/db.ts`, `web/app/actions.ts`, `web/app/submit/page.tsx`, `web/app/page.tsx`, `web/next.config.ts`.

- [x] **T4: Worker, claim loop, extract that queues the checks**
  - `worker/main.py`: stdlib `.env` reader; `connect()` with `isolation_level=None` and the pragmas; `migrate()` at startup; `running` jobs back to `queued` at startup; claim with `BEGIN IMMEDIATE` and `UPDATE ... RETURNING` limited to `kind IN ('extract','similarity')`; `--once`; 2 s idle sleep; a job that throws is `failed` with its error and its report, if any, `error`.
  - `worker/text.py`: `normalize` (NFKC, strip zero-width characters) and `\w+` words with character offsets. `worker/text_test.py`.
  - Extract: under 20 words gives `rejected / too_few_words`; otherwise one transaction sets the document `ready` (normalized `text`, `word_count`, sha256 `content_hash`), inserts both reports, queues `similarity` and `ai`, and marks the extract job `done`.
  - `db_test.py` gains: the claim takes the oldest queued job and never an `ai` job; a `running` job is requeued at startup; a failing job ends `failed` with its report `error`; a successful extract leaves exactly one queued `similarity` and one queued `ai` job.
  - Acceptance: after a paste and `main.py --once`, S03 (reload) shows the draft ready with a pending score, or rejected with its reason.
  - Verify: worker checks; manual 10-word paste gives rejected, 50 words gives ready and a queued similarity job.
  - Files: `worker/main.py`, `worker/text.py`, `worker/text_test.py`, `worker/db_test.py`, `worker/.env.example`.

### Checkpoint CP2
- [x] Web and worker checks pass.
- [x] Paste, extracted, similarity queued with no click; the `ai` job stays queued and untouched. Review with you before Phase 3.

## Phase 3: The engine

- [x] **T5: Scoring rule (row "Similarity score ... each word counted once")**
  - `worker/score.py`: input = draft word count and, per source, its matches as word-index ranges; output = per-source rank, claimed words, matched words, percent, and the total score. Greedy rank by most unclaimed words; ties by more total words, then source id; 0 claimed words means no rank and 0%; the denominator is always the draft word count.
  - `worker/score_test.py`: two overlapping sources (the second gains only its unclaimed words), a tie, a source left with 0 claimed words, a score that never exceeds 100.
  - Files: `worker/score.py`, `worker/score_test.py`.

- [x] **T6: Alignment**
  - `worker/align.py`: lowercase `\w+` tokens with character offsets; word 5-gram hashes (blake2b, 8 bytes, signed, ready for M3 fingerprints); winnow window 4; shared hashes give seeds; extend each seed to the longest exact run; keep runs of 8+ words; merge overlaps; return `(doc_start, doc_end, src_start, src_end, word_count)` in characters.
  - `worker/fixtures/article_page.html` (an original article inside page chrome, instead of copied Wikipedia text) and `worker/align_test.py`: the paragraph pasted between two original sentences is found as one span whose slices match in both texts; a shared 7-word run is not reported and an 8-word run is; changed case and punctuation still match.
  - Files: `worker/align.py`, `worker/align_test.py`, `worker/fixtures/article_page.html`.

- [x] **T7: The `similarity` job (row "Search the live web for matching sources")**
  - `worker/requirements.txt`: pinned `httpx`, `trafilatura`; create the venv.
  - `worker/text.py` `pick_queries(text, budget)`: 12 to 40 word sentences, few stopwords, spread evenly, an 8 to 12 word quoted phrase from each.
  - `worker/search.py`: `brave_search(query)` (`X-Subscription-Token`, `count=3`, 1.1 s spacing, a 429 raises with "Brave rate limit, try again in a minute") and `fetch(url)` (http and https only; refuses hosts that resolve to loopback, private or link-local addresses, including after redirects; robots.txt, 1 request/s per host, 10 s timeout, 5 MB cap, `trafilatura`, `text.normalize`). `similarity_test.py` covers the refusals with `127.0.0.1:3000`, `10.0.0.1`, `169.254.169.254` and `file:///`.
  - `worker/main.py`: the job takes `search` and `fetch` as arguments; report `processing` on claim; all network and alignment with no transaction open; then one `BEGIN IMMEDIATE` writes sources, matches and `report_sources` (via `score.py`) and sets the report `done` with `score`, `queries_used`, `generated_at`; a cached source under 30 days old is reused.
  - `worker/similarity_test.py`: with fake search and fetch, the fixture paragraph is found and the query count never exceeds the budget. `db_test.py` gains one full job on a temp DB with the fakes: report `done`, score above 0, a rerun replaces rather than duplicates rows, and the fake fetch asserts `conn.in_transaction` is false.
  - Verify: worker checks. No Brave key needed.
  - Files: `worker/requirements.txt`, `worker/text.py`, `worker/search.py`, `worker/main.py`, `worker/similarity_test.py`, `worker/db_test.py`.

### Checkpoint CP3
- [x] All worker tests pass, including the full fake-search job. No Brave quota spent so far. Review with you before Phase 4.

## Phase 4: The report

- [x] **U1 (you)** Brave Search API key (free plan) in `worker/.env`; note the monthly quota; optional `UA_CONTACT`.

- [x] **T8: S07 report viewer, score and highlights (row "Report viewer with numbered highlights per source"; F01 end)**
  - `web/app/reports/[id]/page.tsx`: static heading; behind `<Suspense>`: `await connection()`, await `params`, read the report, its document text, matches and ranked `report_sources` with source title and URL; `ScoreBadge size="lg"`; `DocumentViewer` spans `{id, start: doc_start, end: doc_end, rank, label: "Source {rank}: {host}"}` for matches of ranked sources; "Still checking, reload in a moment" when not `done`; the error message when `error`; "No matching text found" at 0%; `notFound()` for an unknown or non-numeric id.
  - S03: the title and `ScoreBadge` of a draft with a report link to `/reports/{reportId}` (`DraftsTable` gets the href per row).
  - Acceptance: highlights are numbered by source rank with the match colours; overlaps show the better rank.
  - Verify: web checks; then the **manual end-to-end check (U2, spends quota)**: with `SEARCH_QUERY_BUDGET=10`, paste a 120 to 200 word paragraph from a current Wikipedia article plus about 80 words of your own, run `main.py`, reload S07. Pass if the report is `done`, `queries_used` is 10 or fewer, the top source contains the paragraph (Wikipedia or a mirror), the highlight covers it give or take a few edge words, your own sentences stay plain, and the score is near the pasted share of words. Record the numbers under "Cost of one check" in `tasks/plan.md`.
  - Files: `web/app/reports/[id]/page.tsx`, `web/components/drafts-table.tsx`, `web/app/page.tsx`, `tasks/plan.md`.

- [x] **U2 (you)** Watch the T8 manual check.

### Checkpoint CP4: milestone 1 done
- [x] Web and worker checks all pass; the manual check passed and its cost is recorded.
- [x] `replica/features.csv` `clone = yes` on: Paste text as a submission; Search the live web for matching sources; Similarity score; Report viewer with numbered highlights per source.
- [x] My review, in this session:
  - Security: the curl Host check; every SQL statement parameterized; draft and source text rendered as text, never HTML; fetcher limits (timeout, 5 MB, robots.txt, no `file:` or private-IP URLs).
  - Browser: F01 walked in the in-app browser at 375 px and 1280 px, keyboard only once; no console errors.
  - Design: S03, S04 and S07 use only the existing primitives and tokens.
