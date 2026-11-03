# Implementation Plan: Milestone 1, the vertical slice

Spec: `replica/architecture.md` ("Personal and local", Stack, The parts that bite, Build order item 1), `replica/features.csv`, `replica/recon.md`, `replica/schema.sql` (SQLite).
Task checklist: `tasks/todo.md` (same IDs).
Revised 2026-10-29 for personal use: no auth (earlier), no confirm step or receipt, no validation library, no retry machinery, one test location, no subagents. All work happens in the main session.

## Overview

Ugly but end to end, all on one PC: paste text (S04), watch it go `extracting` then `ready` on the drafts list (S03), and the worker checks it on its own: search Brave, align, score. Open S07 and see the score with numbered highlights. Two clicks after pasting: Check, then the score.

It proves four things: the web app (`node:sqlite`) and the worker (Python `sqlite3`) share one database file safely, the job queue works, what one check costs (Brave queries and time), and that alignment finds a pasted Wikipedia paragraph.

Out of M1 (M2+): file upload, S08 to S13 panels, filters and `requestRescore`, the `ai` job itself, `/api/status` polling, `retryReport`, OpenAlex/arXiv, library, integrity flags, quote and bibliography detection, confusable replacement, hourly housekeeping.

## What "personal use" changed in this plan

| Was | Now | Why |
| --- | --- | --- |
| Confirm on S03/S05, then the checks start | The extract job queues both checks itself | Nothing is submitted to anyone; the confirm step was Turnitin's guard for instructors. Saves a task. |
| Receipt id, `submitted` status | Gone from the schema | A receipt is proof of submission for an institution. |
| `zod` for every input | Plain checks in two server actions, backed by the schema's CHECKs | The only person typing into the forms is you. No new dependency. |
| Backoff, attempt counts, requeue collision rule | A failing job is `failed` and its report `error`, with the message | You are watching; paste again to rerun. Retry button comes in M2. |
| Schema checks in two languages | Schema checks only in `worker/db_test.py`; `web/lib/db.test.ts` only tests `db.ts` itself (open, version refusal, `tx` rollback) | One place for the schema. `tx` had a real bug caught by its test (below). |
| `next build` + `next start` freeze check | Day to day you run `npm run dev`; `npm run build` stays as a check | `connection()` is still used, so `next start` works too, but you won't run a production server. |
| Hand-offs to security, QA and design agents | My own review at CP4 against a short checklist | Subagents are disabled. |

Kept on purpose, because personal use does not make them unnecessary: the loopback bind and Host check (a website you visit could otherwise reach the app), robots.txt and per-host rate limits (other people's servers), the search budget (your money), and the pragmas (your data).

## Architecture decisions

### 1. Database: one SQLite file, one migration runner
- `db/migrations/001_init.sql` at the project root is a verbatim copy of `replica/schema.sql`. After that the migration files are the truth and `replica/schema.sql` is the frozen spec copy. Changes are new numbered files; an applied file is never edited.
- All nine tables are applied in M1: one migration, and unused tables cost nothing.
- `db/migrate.py` (stdlib): `migrate(path)` opens the file with the three pragmas, reads `PRAGMA user_version`, applies each higher-numbered `NNN_*.sql` in its own transaction, sets `user_version`, and creates `data/` if missing. Running it twice does nothing. CLI: `python db/migrate.py [path]`. The worker calls it at startup.
- The database is `data/draftcheck.db` at the project root. The root `.gitignore` lists `data/`, `worker/.env`, `worker/.venv/`, so none of it is ever committed.
- Every connection runs `PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000` through one helper per language. Times are written only by SQL `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.
- All database checks live in `worker/db_test.py`: a temp file built with the real `migrate.py`.

### 2. Web app (Next 16.4)
- No new dependency. `node:sqlite` (`DatabaseSync`) is built into Node 22.14 (SQLite 3.47.2, unflagged, prints an ExperimentalWarning). Fallback if it fails under Next's bundler: `better-sqlite3`, which Next externalizes automatically; same SQL.
- `web/lib/db.ts`, the only file that touches the database:
  - `db()` opens lazily on first call (so `next build` never creates the file), caches the handle on `globalThis` (survives dev reloads), runs the pragmas, and checks `user_version` is 1. On a mismatch every request fails with "Database is at version N, run `python db/migrate.py`".
  - `DATABASE_PATH` env, default `path.resolve(process.cwd(), '../data/draftcheck.db')` (npm runs scripts in `web/`).
  - `tx(fn)`: `BEGIN IMMEDIATE ... COMMIT`, `ROLLBACK` on throw.
  - `submitText(title, text)`: one transaction inserts the document (`extracting`, raw text) and its `extract` job (`ON CONFLICT DO NOTHING`); returns the id.
  - Read queries for S03 and S07.
- **`cacheComponents` and a synchronous driver.** The Next caching guide (`node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md`) says queries to synchronous drivers such as `node:sqlite` run during prerender. So every server component that reads the database calls `await connection()` (from `next/server`) first and sits behind `<Suspense>`. No `use cache` anywhere.
- `web/proxy.ts` (Next 16's name for middleware) is a Host check only: 403 unless `Host` is `localhost:3000`, `127.0.0.1:3000` or `[::1]:3000`, and 403 when Host is missing. Next's server-action origin check does not stop DNS rebinding, because a rebound page's Origin and Host match.
- Scripts: `"dev": "next dev -H 127.0.0.1"`, `"start": "next start -H 127.0.0.1"`. `.claude/launch.json` `web` gets `"url": "http://127.0.0.1:3000"` (on Windows `localhost` can resolve to `::1` first, where nothing listens).
- `next.config.ts`: `experimental.serverActions.bodySizeLimit: '3mb'` (default 1 MB; pastes are capped at 2 MB).
- Input checks in `submitText`: title trimmed, 1 to 300 characters; text non-empty, at most 2 MB of UTF-8. A failure re-renders S04 with an `InlineAlert`.
- Reused primitives, no new styling: `TextField`, `TextArea`, `Button`, `InlineAlert`, `AppHeader`, `EmptyState`, `Skeleton`, `StatusPill`, `DraftsTable`, `ScoreBadge`, `AiBadge`, `DocumentViewer` (data props only), `lib/report.ts`.

### 3. Worker at `worker/` (project root), Python 3.11
- Modules: `main.py` (env, connection helper, migrate at startup, claim loop, dispatch, writes), `text.py`, `align.py`, `score.py`, `search.py`. Tests: `text_test.py`, `align_test.py`, `score_test.py`, `similarity_test.py`, `db_test.py`. One fixture: `fixtures/wiki_paragraph.html` (CC BY-SA, attributed).
- Stdlib only until T7, then `requirements.txt` with pinned `httpx` and `trafilatura`. venv at `worker/.venv`. Tests use `unittest`.
- Connection: stdlib `sqlite3` with `isolation_level=None` (Python otherwise opens transactions silently) and explicit `BEGIN IMMEDIATE` for every write. Never `executescript` inside a transaction (it commits first).
- Claim: the `schema.sql` query plus `AND kind IN ('extract','similarity')`, so the `ai` jobs wait for M2.
- **Extract success, one transaction:** document `ready` with normalized `text`, `word_count`, `content_hash`; insert its similarity report and AI report; queue `similarity` (report) and `ai` (document); mark the extract job `done`.
- **Network before the write transaction, never inside it.** The similarity job searches, fetches and aligns with no transaction open, then one short `BEGIN IMMEDIATE` writes everything.
- Failures: the job is `failed` with its error, and its report (if any) `error` with the message. At startup, any `running` job goes back to `queued` (with one worker it can only be from a crash).
- Env (`worker/.env`, a few stdlib lines to read it; template `worker/.env.example`): `BRAVE_API_KEY`, `SEARCH_QUERY_BUDGET` (10 while developing, architecture default 40), `UA_CONTACT` (optional, appended to the fetcher's User-Agent), `DATABASE_PATH` (optional, default `../data/draftcheck.db`).
- Start on Windows (PowerShell, from `worker/`):
  ```
  py -3.11 -m venv .venv
  .venv\Scripts\pip install -r requirements.txt   # from T7 on
  .venv\Scripts\python main.py          # migrate, then loop; Ctrl+C to stop
  .venv\Scripts\python main.py --once   # claim one job, run it, exit
  .venv\Scripts\python -m unittest discover -p "*_test.py"
  ```

### 4. Similarity in M1
- Queries: sentences of 12 to 40 words with few stopwords, spread evenly, one 8 to 12 word exact phrase in quotes from each; at most `SEARCH_QUERY_BUDGET`; Brave `count=3`; 1.1 s between queries; a 429 fails the job with "Brave rate limit, try again in a minute". `queries_used` is written to the report.
- Fetch: distinct URLs only; http and https only; never a host that resolves to a loopback, private or link-local address, checked again after each redirect (search results are untrusted, and `127.0.0.1:3000` is your own app); reuse a cached `sources` row for the same URL fetched under 30 days ago; 10 s timeout, 5 MB cap, `robots.txt` via `urllib.robotparser`, 1 request/s per host, `trafilatura`, then `text.normalize`.
- Align: exact token runs of 8+ words, found by winnowing (word 5-grams, window 4) seeds extended forward and back. Fuzzy merging comes later.
- Every match gets `match_group = 'not_cited_or_quoted'` (groups are M3, filters M2).
- One write transaction: delete the report's old `matches` and `report_sources`, upsert `sources`, insert matches, run `score.py`, insert `report_sources`, set the report `done` with `score`, `queries_used`, `generated_at`.

### 5. How work is verified
- Web, every task, from `web/`: `npx tsc --noEmit`, `npx eslint`, `npm test`, `npm run build`.
- Worker and database: `python -m unittest discover -p "*_test.py"` from `worker/`.
- Host lock: with `npm run dev` running, `curl -s -o NUL -w "%{http_code}" -H "Host: evil.test:3000" http://127.0.0.1:3000/` prints 403, and without the header 200.
- **No automated test spends Brave quota.** The similarity job takes `search` and `fetch` as plain function arguments; tests pass fakes and the fixture page.
- **One manual end-to-end check spends quota** (T8): about 6 to 10 queries.

## Phases and tasks

| ID | Task | Depends on | Size |
| --- | --- | --- | --- |
| T1 | Database: `001_init.sql`, `db/migrate.py`, root `.gitignore`, `worker/db_test.py` | None | S |
| T2 | Web database layer and loopback lock: `web/lib/db.ts`, `node:sqlite` proven under dev and build, `web/proxy.ts`, `-H 127.0.0.1` | T1 | M |
| CP1 | Checkpoint: migrations work, the web app reads the DB per request, the Host check answers 403 | | |
| T3 | Paste and list: S04 `/submit` with `submitText`; S03 `/` lists drafts with status | T2 | M |
| T4 | Worker: migrate at startup, claim loop, `extract` for pasted text that queues both checks, failure and crash handling | T3 | M |
| CP2 | Checkpoint: paste, extracted, similarity queued with no click; `ai` left queued | | |
| T5 | `score.py` + `score_test.py` (rescore rule, no filters) | None | S |
| T6 | `align.py` + `align_test.py` with the Wikipedia fixture | None | S |
| T7 | `similarity` job: queries, Brave client, fetcher, one write transaction; fake-search tests | T4, T5, T6 | M |
| CP3 | Checkpoint: a full similarity job runs on a temp DB with no quota spent | | |
| T8 | S07 `/reports/[id]`: score and highlights; S03 links to it; manual Brave check | T7, U1 | M |
| CP4 | Checkpoint: milestone 1 done, my review | | |

T5 and T6 are pure logic with no dependencies: safe to build first.

## Your steps

| ID | Step | Blocks |
| --- | --- | --- |
| U1 | Get a Brave Search API key on the free plan, note its monthly quota, and put it in `worker/.env` as `BRAVE_API_KEY` (template `worker/.env.example`). Optionally set `UA_CONTACT` (Wikipedia asks bots for a contact in the User-Agent). | Only T8's manual check. Any time before then. |
| U2 | Watch the T8 manual check (about 6 to 10 Brave queries). | CP4 |

## Decided defaults

- S03's draft title links to its report once the report exists; before that it is plain text.
- S07 has no source list in M1 (that is S08 in M2); a highlight's source is in its accessible label.
- No polling: reload S03 and S07 to see status change.
- The S03 AI badge shows `--` for all of M1.
- Rejected pasted text shows the existing "Can't read file" pill; the reason ("too few words") shows next to it.
- `score_test.py` gets the small-source and quoted-match cases in M2 with the filters.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `node:sqlite` is experimental and may not bundle cleanly under Turbopack | High | T2 proves it under `next dev` and `next build` before any feature uses it; fallback `better-sqlite3`, same SQL. |
| Synchronous DB reads baked into the build output (`cacheComponents`) | Med | `await connection()` before every read, behind `<Suspense>`; lazy open. You run `next dev`, where it cannot happen anyway. |
| DNS rebinding reaches the loopback app | High | Host allowlist in `web/proxy.ts`, checked with curl in T2; `-H 127.0.0.1`. |
| A connection without `foreign_keys = ON` silently skips cascades | Med | One connection helper per language; `db_test.py` checks a cascade through the worker's helper. |
| Python `sqlite3` implicit transactions, `executescript` committing | Med | `isolation_level=None` with explicit `BEGIN IMMEDIATE`; `migrate.py` applies each file in its own transaction. |
| Brave free quota is small and plans change | Med | Budget 10 while developing; zero quota in tests; T8 records the real cost. |
| Exact-phrase queries return mirrors or nothing; some sites refuse a generic User-Agent | Med | T8 accepts any source that contains the paragraph; `UA_CONTACT`; robots.txt respected. |
| `data/` is the only copy of your drafts | Low | Backup note in the architecture. |

## Open question

- **Q1, resolved 2026-10-29.** The project root is now one git repository (`web/`'s scaffold-only repository was folded in), pushed to the private GitHub repo `chakradhar09/draftcheck`. Baseline, Phase 1 and Phase 2 are separate commits.

## Found while building

- **T2:** `node:sqlite` on Node 22.14 has no `isTransaction` (it arrived later in Node 22), so a rollback guarded by it silently never ran. `tx` now always attempts `ROLLBACK`, and `@types/node` is pinned to 22.14 so the type checker matches the runtime.
- **T2:** `node:sqlite` bundles and runs under Turbopack in both `next dev` and `next build`; no `better-sqlite3` fallback needed. `/` builds as partial prerender, with the database read streamed per request.
- **T2:** Next warns that it ignores a `package-lock.json` in `C:\Projects` (outside this project). Harmless; not touched.
- **T4:** browsers submit `<textarea>` line breaks as `\r\n`, so `text.normalize` also turns `\r\n` and `\r` into `\n`; otherwise every offset after a line break would be off and paragraphs would not split.
- **T4:** the worker only claims kinds that have a handler (`HANDLERS` in `main.py`): `extract` now, `similarity` from T7, `ai` in M2. Queued jobs of other kinds simply wait.
- **T6:** the fixture is an original article (`worker/fixtures/article_page.html`), not copied Wikipedia text, so no third-party text lives in the repo; the real Wikipedia check stays in T8. `align_test.py` also checks the winnowing guarantee on 300 random text pairs, and that test fails if the window is widened.
- **T7:** pinned `httpx==0.28.1` and `trafilatura==2.3.1`; `trafilatura.bare_extraction(html, with_metadata=True)` gives the title and main text without nav, related links or footer. The worker now needs its venv for every test run.
- **T7:** the fetcher checks each redirect hop's address before its robots.txt lookup. Checked the other way round, a redirect into `127.0.0.1` was still refused, but silently as "disallowed by robots".
- **T7:** a search result that is unsafe or fails to fetch is skipped and logged; it does not fail the check. A missing `BRAVE_API_KEY` fails the check with a message naming `worker/.env`.
- **T8:** a report id that does not exist shows Next's 404 page, but the HTTP status stays 200: the report is read inside `<Suspense>`, after the streamed shell has already sent its status. Normal for streamed pages, and harmless for a local app.
- **CP4:** the header's Library link pointed at S17, which is M3, and Next's link prefetching hit the 404 on every page. The link is out of the nav until the page exists. Other 404s in the dev log (`/api/v2/workspaces?q=owner:me`) come from something else on this machine polling port 3000, not from the app.
- **CP4 review:** no `dangerouslySetInnerHTML` anywhere; every SQL value is a `?` parameter (the f-strings only splice in constants); the Host check still answers 403 to a foreign Host on the new route; 375 px has no horizontal scroll on S03 and S07; keyboard focus shows the 2 px ring at every stop on S03.
- **T3/T4:** `DraftsTable` badges and the title link became optional (a draft still being read, or rejected, has no report), and `ui.tsx` gained `buttonClass()` so links can look like buttons. Both are additive; `/design` still renders.

## Cost of one check (T8, 2026-10-29)

- Draft words: 134 (a pasted Wikipedia passage, "Chain of custody")
- Queries used / budget: 5 / 10 (the draft has 5 searchable sentences)
- Pages fetched (cached reused): 2 (0)
- Wall time of the similarity job: about 10 s (11 s for the worker run)
- Score and top source: 100%, `en.wikipedia.org/wiki/Chain_of_custody`, rank 1, all 134 words. A second page (an Everlaw blog post) shares an 18-word passage but gets no rank, because Wikipedia already claimed those words.
- Not exercised by this run: own words staying plain (every word of the paste is in the article). Covered by the fake-search check on the real database (56%, own sentences plain) and by `db_test.py`.
- At this rate, a 1,000-word essay would use the whole default budget of 40 queries; the free plan's monthly quota decides how many such checks a month you get.
