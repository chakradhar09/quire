# Milestone 2 todo: the must-haves

Plan and decisions: `tasks/plan.md`. Milestone 1: `tasks/m1/`. Built in the main session; each phase is its own commit.
Web checks = from `web/`: `npm run build` (when routes change, so route types exist), `npx tsc --noEmit`, `npx eslint`, `npm test`.
Worker checks = from `worker/`: `.venv\Scripts\python -m unittest discover -p "*_test.py"`.
No automated test spends Brave quota or loads an AI model.

## Phase 1: Files

- [x] **T1: Upload a file (S04; rows "Upload a file", "Reject invalid files")**
  - `web/lib/upload.ts`: `checkUpload(name, size)` for the five extensions and 50 MB; `allowedOrigin(origin)` for `http://127.0.0.1:3000` and `http://localhost:3000`; `saveUpload(...)` inserts the document and its `extract` job and writes `data/uploads/{id}/original{.ext}`, deleting the row if the write fails. Tests in `web/lib/upload.test.ts` with a temp database and folder, including a `../../evil.docx` name and a missing or foreign Origin.
  - `web/app/api/upload/route.ts`: 403 for a foreign or missing Origin; 413 from `Content-Length` over 50 MB; 400 with the message for a bad type or title; on success, redirect to `/` (303).
  - S04: a "Upload a file" and "Paste text" choice; `Dropzone` uses `checkUpload` (replacing `checkFile` in `dropzone.tsx`); a title field defaulting to the file name.
  - Acceptance: a `.docx` upload creates one `extracting` document with `filename`, `file_path`, `mime`, `size_bytes` and one queued `extract` job; a `.pages` file, a 51 MB file and a cross-site post are refused with the right message or status.
  - Verify: web checks; upload in the browser; a `curl` post with `Origin: http://evil.test` gets 403.
  - Files: `web/lib/upload.ts`, `web/lib/upload.test.ts`, `web/app/api/upload/route.ts`, `web/app/submit/page.tsx`, `web/app/submit/upload-form.tsx`, `web/components/dropzone.tsx`.

- [x] **T2: The worker reads the five formats (row "Reject invalid files")**
  - `worker/requirements.txt` adds pinned `pdfplumber`, `python-docx`, `striprtf`, `odfpy`.
  - `worker/extract.py`: `read_file(path)` returns `(text, page_count)` or raises `Rejected(reason)`: DOCX paragraphs; PDF pages (no characters means `image_only_pdf`, over 800 pages means `too_many_pages`); RTF; ODT; TXT as UTF-8 then cp1252; DOCX or ODT over 200 MB uncompressed means `extraction_failed`.
  - `worker/main.py` `extract`: reads the file when `file_path` is set, else the pasted text; same normalize, word count and queueing as before; records `page_count`; a `Rejected` sets the document `rejected` with its reason.
  - `worker/extract_test.py`: each format built in the test (DOCX and ODT with their own libraries, RTF and TXT as strings, PDFs from a tiny hand-written PDF writer: one with text, one image-only); a cp1252 `.txt`; a zip bomb; a corrupt file. `db_test.py` gains an upload going through `extract` to `ready`.
  - Acceptance: each format comes out `ready` with the right text and word count; an image-only PDF, a 10-word DOCX and a corrupt file each come out `rejected` with their reason shown on S03.
  - Files: `worker/requirements.txt`, `worker/extract.py`, `worker/extract_test.py`, `worker/main.py`, `worker/db_test.py`.

- [x] **T3: Delete a draft**
  - `web/lib/db.ts` `deleteDocument(id)`: deletes the row (reports, matches, jobs cascade) and then `data/uploads/{id}/` (the path built from the integer id only). Tested in `db.test.ts`.
  - `web/app/actions.ts` `deleteDraft`; S03 row `Menu` with "Open report" and "Delete", the delete going through the `Modal` destructive confirm.
  - Acceptance: deleting a draft removes it from S03, its report URL shows 404, its upload folder is gone, and other drafts are untouched.
  - Files: `web/lib/db.ts`, `web/lib/db.test.ts`, `web/app/actions.ts`, `web/app/page.tsx`, `web/app/draft-menu.tsx`.

### Checkpoint CP1: files
- [x] Web and worker checks pass.
- [x] In the browser: upload one file of each format and watch it become ready and checked; upload an image-only PDF and a `.pages` file and see them refused; delete a draft.
- [x] Commit Phase 1.

## Phase 2: One scoring path

- [x] **T4: Quotes and reference list (rows "Filter: exclude quotes", "Filter: exclude bibliography")**
  - `worker/text.py`: `quote_spans(text)` (straight or curly double quotes, up to 1,200 characters, never across a missing closing quote) and `bibliography_start(text)` (the last heading line "References", "Bibliography", "Works cited", "Sources" or "Literature cited" in the final 40%). Tests in `text_test.py`.
  - `extract` stores them; `similarity` sets `in_quote` (at least half the match inside a quote span) and `in_bibliography` (starts at or after `bibliography_start`).
  - Acceptance: a draft with a quoted sentence and a reference list stores both; its matches carry the right flags.
  - Files: `worker/text.py`, `worker/text_test.py`, `worker/main.py`, `worker/db_test.py`.

- [x] **T5: Rescore (rows "Filter: exclude small matches under N words", "Exclude a source and restore it")**
  - `worker/rescore.py` `rescore(conn, report_id)` (called inside a transaction): reads settings, matches and exclusions; sets `hidden_reason` in the order `match_excluded`, `source_excluded`, `quote`, `bibliography`, then `small_source` for sources under `small_match_words`; maps character offsets to word ranges with `words()` and bisect; scores with `score.py`; writes `report_sources` rank, percent, matched words, the report score, `status = 'done'`.
  - `similarity` writes raw matches and calls `rescore` in its write transaction; `HANDLERS['rescore']` runs it on its own.
  - `worker/rescore_test.py`: each filter alone; a source excluded and restored; small sources hidden whole; an excluded top source lets the next one claim its words; the score never counts hidden words, and the denominator stays the whole draft.
  - Acceptance: similarity results are unchanged with all filters off (M1 tests still pass); each filter changes exactly what it should.
  - Files: `worker/rescore.py`, `worker/rescore_test.py`, `worker/main.py`, `worker/db_test.py`.

### Checkpoint CP2: one scoring path
- [x] Worker checks pass; the similarity job and the rescore job produce the same result for the same settings.
- [x] Commit Phase 2.

## Phase 3: Report UI

- [x] **T6: Live status (row "Processing status while a report builds")**
  - `web/components/auto-refresh.tsx`: `router.refresh()` every 3 s while `active`.
  - `listDrafts` adds `waiting` (a queued job older than 60 s); S03 shows the "Waiting for worker" pill with a note to run `python main.py` in `worker/`; S03 and S07 refresh while anything is unfinished.
  - `db.ts` `retryReport(id)` and the `retry` action: an `error` report goes back to `queued` with a `similarity` job; offered on S07's failed state and in the S03 menu. Tested in `db.test.ts`.
  - Acceptance: a paste moves from Checking to a score on S03 with no reload while the worker runs; with the worker stopped, the pill appears after a minute; a failed report can be retried.
  - Files: `web/components/auto-refresh.tsx`, `web/lib/db.ts`, `web/lib/db.test.ts`, `web/app/actions.ts`, `web/app/page.tsx`, `web/app/reports/[id]/page.tsx`.

- [x] **T7: Sources panel and compare (S08, S10; rows "Ranked sources list", "Side-by-side match comparison")**
  - `getReport` returns ranked sources (rank, percent, matched words, title, url, type, excluded), matches with their source passage and context, and the filter settings. Tested in `db.test.ts`.
  - `web/app/reports/[id]/report-view.tsx` (client): `DocumentViewer` with `onSelect`; side panel `PanelTabs` with Sources (`SourceCard` list in rank order); selecting a highlight or a source opens `SplitCompare` for that match with previous and next; `?panel=` and `?match=` in the URL; panel below the paper under `lg`.
  - Acceptance: every source on the report is listed with its percent; clicking a highlight shows your passage beside the source's with a link to the page; reloading keeps the selection.
  - Files: `web/lib/db.ts`, `web/lib/db.test.ts`, `web/app/reports/[id]/page.tsx`, `web/app/reports/[id]/report-view.tsx`.

- [x] **T8: Filters and exclusions (S11, S12)**
  - `db.ts`: `updateReportSettings`, `setSourceExcluded`, `setMatchExcluded`, each with `requestRescore` (report `recalculating`, one queued `rescore` job) in one transaction. Tested in `db.test.ts`.
  - `actions.ts` wrappers; Filters tab (quotes and reference-list switches, small-match words, Apply); Exclude on each `SourceCard`, an Excluded section with Restore at the bottom of Sources; Exclude match in `SplitCompare`; S07 shows the recalculating badge and refreshes until `done`.
  - Acceptance: turning on "leave out quoted text" on a report with a quoted match lowers the score after the rescore; excluding the top source re-ranks the rest; restoring it brings the original score back.
  - Files: `web/lib/db.ts`, `web/lib/db.test.ts`, `web/app/actions.ts`, `web/app/reports/[id]/report-view.tsx`.

### Checkpoint CP3: report UI
- [x] Web and worker checks pass.
- [x] In the browser, on a real report: sources listed, compare works, each filter and exclusion recalculates and the score moves as expected; 375 px and keyboard pass.
- [x] Commit Phase 3.

## Phase 4: AI writing

- [x] **T9: AI pipeline with a stand-in scorer (rows "AI writing score", "AI score guardrails")**
  - `worker/requirements.txt` adds pinned `py3langid`.
  - `worker/ai.py`: `prose_sentences(text, bibliography_start)`, `windows(sentences)` (about 120 to 200 words), `analyse(text, bibliography_start, scorer, threshold)` returning status, unavailable reason, qualifying words, segments, score. `ai_job(conn, job, scorer, threshold, model)` writes `ai_reports` in one transaction; `mark_failed` marks `ai_reports` `error` for a failed `ai` job.
  - `worker/ai_test.py` with a stand-in scorer: lists and headings are not prose; under 300 qualifying words is `too_few_words`; French text is `unsupported_language`; windows under the threshold become segments; the score is AI words over qualifying words.
  - Acceptance: every rule in the spec's AI section has a test; nothing loads a model.
  - Files: `worker/requirements.txt`, `worker/ai.py`, `worker/ai_test.py`, `worker/main.py`, `worker/db_test.py`.

- [x] **T10: S14 AI report and the S03 AI badge (row "Submissions list with similarity and AI scores")**
  - `db.ts` `getAiReport(documentId)`; `listDrafts` already returns AI status and score. Tested in `db.test.ts`.
  - `web/app/documents/[id]/ai/page.tsx` (S14): the draft with `ai` segments in `DocumentViewer`, the legend, the disclaimer, `*` and no highlights under 20%, the reason when unavailable, "uncalibrated" until T12; refreshes while queued.
  - S03: the AI badge shows done, `*`, unavailable or pending and links to S14.
  - Acceptance: with stand-in results written to the database, S14 shows each state correctly at 375 px and 1280 px.
  - Files: `web/lib/db.ts`, `web/lib/db.test.ts`, `web/app/documents/[id]/ai/page.tsx`, `web/app/page.tsx`.

- [x] **T11: Binoculars on the real models (GPU, Qwen2.5-1.5B pair)**
  - `worker/requirements.txt` adds pinned `torch` (CUDA build, from the PyTorch index) and `transformers`.
  - `worker/binoculars.py`: loads `AI_OBSERVER` (default `Qwen/Qwen2.5-1.5B`) and `AI_PERFORMER` (default `Qwen/Qwen2.5-1.5B-Instruct`) once, in fp16 on `AI_DEVICE` (default CUDA if available, else CPU); `score(texts)` returns the Binoculars ratio per window. `HANDLERS['ai']` uses it with `AI_THRESHOLD` (an uncalibrated default until T13), recording pair, device, threshold and calibration state in `ai_reports.model`.
  - `worker/binoculars_test.py`: an opt-in smoke test (`AI_SMOKE=1`) that loads the models, scores a human paragraph and a model-written one, and checks the second scores lower.
  - Acceptance: `torch.cuda.is_available()` is true; the queued `ai` job for your existing draft runs and S14 shows a result; time per 1,000 words recorded in the plan.
  - Add `'ai'` to the job kinds behind `waiting` in `listDrafts` and to `unfinished()` on S03, which leave it out until the worker has an `ai` handler. (Moved here from T10: with no handler yet, every draft would show "Waiting for worker".)
  - Files: `worker/requirements.txt`, `worker/binoculars.py`, `worker/binoculars_test.py`, `worker/main.py`, `worker/.env.example`.

- [x] **U1 (you)** Create a free OpenRouter account and API key; put it in `worker/.env` as `OPENROUTER_API_KEY`.

- [x] **T12: Calibration data**
  - `worker/calibration/persuade.py`: downloads the PERSUADE 2.0 training CSV (CC BY 4.0) from the authors' Google Drive link into `data/calibration/` once, handling Drive's confirmation page; checks the expected columns; `sample(n, seed)` returns essays spread across the 15 prompts, each with at least 300 words of prose.
  - `worker/calibration/generate_ai.py`: for each prompt, asks two or three free OpenRouter models for student-style essays (a few per prompt, about 45 in all), saving `data/calibration/ai/{prompt}-{model}-{n}.txt`; 20 requests a minute; resumes by skipping files that exist; stops with a clear message at the daily limit. Sends only the essay prompts.
  - Tests with `httpx.MockTransport` (Drive confirmation page, OpenRouter reply, 429) and a tiny CSV: no network.
  - Acceptance: `data/calibration/` holds the CSV and the AI essays; the sample is the same on every run; nothing under `data/` is committed.
  - Files: `worker/calibration/__init__.py`, `worker/calibration/persuade.py`, `worker/calibration/generate_ai.py`, `worker/calibration/calibration_test.py`, `worker/.env.example`.

- [x] **T13: Calibrate the threshold**
  - `worker/calibrate_ai.py [--human-csv | --human <folder>] [--ai <folder>]`: folders may hold `.txt .docx .pdf .rtf .odt` (read with `extract.py`); scores every window with Binoculars; sets the threshold so at most 1% of human windows fall under it; reports the AI windows and whole AI essays caught, and the human essays that would score 20% or more; writes `data/calibration/report.md` (crediting PERSUADE 2.0) and prints the `AI_THRESHOLD=` line.
  - With `AI_THRESHOLD` set, `ai_reports.model` records it as calibrated and S14 shows "calibrated on PERSUADE 2.0 student essays" with the false-positive rate instead of "uncalibrated".
  - `worker/calibrate_ai_test.py`: threshold maths and report with a stand-in scorer.
  - Acceptance: run on the T12 data; the report shows at most 1% human false positives at the chosen threshold, and the detection rate on the AI essays.
  - Files: `worker/calibrate_ai.py`, `worker/calibrate_ai_test.py`, `worker/binoculars.py`, `web/app/documents/[id]/ai/page.tsx`.

### Checkpoint CP4: milestone 2 done
- [x] Web and worker checks pass.
- [x] **U2 (you)** watch the final run: upload a DOCX with a copied passage, a quotation and a reference list; the check finds the source; each filter moves the score as expected; the AI estimate appears on S14.
- [x] `replica/features.csv` `clone = yes` on the 12 rows listed in `tasks/plan.md`.
- [x] Review: upload route Origin and path checks, no HTML injection, every SQL value a parameter, 375 px and keyboard on S03, S04, S07, S14; no console errors.
- [x] Commit Phase 4.

## Open follow-ups

- [ ] **Classifier v7: stop flagging old literature.** v6 (`data/calibration/classifier/model-v6`, threshold 0.1246) flags 16% of TextSight's public-domain literature windows (v5 0.2%), 34% of WasItAI's old_testset and the 2024 NYBooks page, so it is not the default yet; the app still runs v5. Add pre-1930 human literature (Project Gutenberg) to `classifier_data.documents`, retrain, and switch only if literature returns to about 1% while v6's gains hold (patents 0 of 150, WasItAI raw AI 59-91%). Numbers: `tasks/plan.md`, "Classifier v6".
- [ ] Rerun `python -m calibration.generate_nvidia --kind fields --minutes 80` when NVIDIA's API answers again (it wrote 0 of 256 papers on 2026-11-02) and fold them into v7.
