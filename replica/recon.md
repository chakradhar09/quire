# Recon map: Turnitin (web)

Scope: submit a paper, get a Similarity Report (score, highlighted matches, sources, filters) and an AI writing report. No classes, grading, LMS or instructor roles.
For: one user (the owner) self-checking their own drafts. Personal use, not sold.
Date: 2026-10-28
Method: public sources only (help docs, university guides). No account was used, no screenshots taken, no app code or network calls read. `replica/screens/` stays empty until a public walkthrough is worth capturing.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | help center (Similarity Report) | https://guides.turnitin.com/hc/en-us/articles/23476785544973 | official guide, new report experience |
| 2 | help center (filters) | https://guides.turnitin.com/hc/en-us/articles/25042947311757 | filters and exclusions |
| 3 | help center (match groups / flags) | https://guides.turnitin.com/hc/en-us/articles/27397357797517 | four match groups |
| 4 | iThenticate docs: filters | https://fa-help.turnitin.com/ithenticate/individual/user/the-similarity-report/filters-and-exclusions.htm | small-match threshold, source exclusion (host was unreachable when fetched) |
| 5 | Turnitin flags docs | https://help.turnitin.com/feedback-studio/flags.htm | hidden text, replaced characters |
| 6 | iThenticate flags docs | https://help.turnitin.com/ithenticate/user/the-similarity-report/flags.htm | same flags, other product |
| 7 | university guide: AI detection | https://www.liverpool.ac.uk/media/livacuk/centre-for-innovation-in-education/digiguides/guidance-for-using-ai-detection-tool-in-turnitin/guidance-for-using-ai-detection-tool-in-turnitin.pdf | under 20% shows `*`, no highlights |
| 8 | Turnitin AI how-to guide (mirrored) | https://www.fau.edu/canvas/Files/turnitin-ai-detection_how-to-use-guide.pdf | only prose sentences count, 300-word minimum |
| 9 | university guide: AI writing | https://helpdesk.arcadia.edu/hc/en-us/articles/46219290783117-Turnitin-AI-Writing-Detection | cyan = AI, purple = AI-paraphrased |
| 10 | university guide: enhanced report | https://www.tcd.ie/itservices/vle/staff-guides/assessment/turnitin/new-standard-assignment/viewing-the-enhanced-similarity-report/ | panels and layout |
| 11 | university guide: enhanced report | https://www.qmul.ac.uk/technology-enhanced-learning-team/news/items/turnitins-enhanced-similarity-report.html | match groups, flags |
| 12 | university guide: view matches | https://sites.reading.ac.uk/tel-support/2018/06/28/turnitin-similarity-report-access-and-view-matches/ | classic match overview |
| 13 | university guide: Draft Coach | https://elearning.ufl.edu/media/elearningufledu/using_draft_coach.pdf | the student self-check flow (closest to our use) |
| 14 | university guide: Draft Coach | https://www.wilmu.edu/canvas/draft-coach-similarity-check.aspx | 3 checks per document |
| 15 | university guide: file limits | https://libanswers.leedsbeckett.ac.uk/faq/179518 | 100 MB, 20 words, 800 pages |
| 16 | university guide: file types | https://sites.reading.ac.uk/tel-support-students/turnitin-what-file-types-can-i-submit/ | image-only PDFs rejected |
| 17 | marketing site | https://in.turnitin.com/products/similarity/ | the pitch |

Not used: pricing (institution-only, not public), app store listings (no consumer app), the user's own account (none).

## Core loop

Upload a draft, wait about a minute, and get back two numbers you can trust: how much of the text matches existing sources (with every match highlighted and linked to its source) and how much looks AI-written.

## Screens

Original screens as described in public docs. Ones the clone does not need for a single user are marked _(clone: drop)_.

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Sign in | turnitin.com login or via LMS | auth _(clone: drop, local single user)_ | form | filled, error |
| S02 | Dashboard / class list | after login | pick a class _(clone: becomes S03)_ | card list | empty, filled |
| S03 | Submissions list (assignment inbox) | open an assignment | every submission with its scores | data table, score badge, AI badge, upload button | empty, processing (`--`), filled, error |
| S04 | Submit paper | "Upload submission" | pick file or paste text | dropzone, file picker, paste textarea, title input, cloud pickers (Drive/OneDrive) | empty, file chosen, error (bad type, too big, < 20 words, image-only PDF) |
| S05 | Confirm submission | after upload | preview the extracted text before committing | text preview, page/word count, confirm/cancel | filled, extraction failed |
| S06 | Digital receipt | after confirm | proof of submission | submission ID, date, file name, word count, download | filled |
| S07 | Similarity Report viewer | click the similarity % | read the document with matches highlighted | document viewer, numbered colored highlights, score header, side panel tabs | loading, filled, 0% (no matches), report regenerating |
| S08 | Sources panel (match overview / all sources) | S07 side panel tab | ranked list of sources with % each | source card (rank, type icon, title/URL, %), exclude buttons | empty, filled |
| S09 | Match groups panel | S07 side panel tab | matches grouped by quote/citation status | four group cards with counts and %: Not cited or quoted, Missing quotation, Missing citation, Cited and quoted | empty groups, filled |
| S10 | Match detail / source comparison | click a highlight or source card | see the matched passage side by side with the source text | split pane, source link, prev/next match, exclude | filled, source unavailable |
| S11 | Filters and settings | S07 filter icon | change what counts toward the score | toggles (quotes, bibliography, source types: internet, publications, submitted works), small-match threshold (words or %), apply | default, dirty, recalculating |
| S12 | Excluded sources | S08 / S11 | review and restore excluded sources | list, checkbox, restore | empty, filled |
| S13 | Integrity flags panel | S07 flags tab | text manipulation found | flag card (hidden text, replaced characters), jump to location | none found, flags found |
| S14 | AI writing report viewer | click the AI % | document with AI-likely text highlighted | AI score header, cyan (AI) / purple (AI-paraphrased) highlights, legend, disclaimer | loading, `*` (< 20%, no highlights), filled, not available (< 300 words, non-English, unsupported file) |
| S15 | Download menu | S07 download icon | export | menu: current view PDF, digital receipt, original file | default |
| S16 | Settings: storage / repository | assignment settings | whether the paper is added to the comparison repository | radio (store / do not store) _(clone: becomes S17)_ | default |
| S17 | My reference library _(clone only)_ | nav | add your own documents to compare against (old drafts, course readings) | dropzone, doc table, delete | empty, filled |

Mobile: Turnitin's report is a desktop experience. The clone should at least read on a phone (S03, S07 with the panel as a bottom sheet).

## Flows

```
F01 Check a draft (core loop)
    S03 submissions -> S04 submit -> S05 confirm -> S06 receipt -> S03 (processing --, then %) -> S07 report
    happy path clicks: 7 (open assignment, upload, choose file, upload, confirm, close receipt, click %)
    clone target: 2 (drop file on S03, click score when ready)
    edge: < 20 words, image-only PDF, > 100 MB or > 800 pages, unsupported type (.pages),
          extraction garbles text, processing fails, no internet for source search

F02 Inspect a match
    S07 -> click highlight -> S10 side by side -> next match / back
    happy path clicks: 1
    edge: source URL dead, match spans a page break, same passage matches several sources

F03 Refine the score with filters
    S07 -> S11 toggle exclude quotes / bibliography / small matches < N words -> apply -> S07 (recalculated)
    happy path clicks: 3
    edge: no bibliography heading found, quotes with curly vs straight marks, filter hides every match

F04 Exclude a source, then restore it
    S08 -> exclude source -> score recalculates -> S12 -> restore
    happy path clicks: 2 to exclude, 3 to restore
    edge: excluding the top source lets a lower source claim the overlapping words (score drops less than expected)

F05 Read the AI writing report
    S03 or S07 -> click AI % -> S14
    happy path clicks: 1
    edge: < 300 words of prose, score under 20% (show *), lists and bullet points ignored, non-English

F06 Review integrity flags
    S07 -> S13 -> click flag -> jump to location in S07
    happy path clicks: 2
    edge: white text on white, lookalike Cyrillic/Greek letters, zero-width characters

F07 Download the report
    S07 -> S15 -> current view PDF
    happy path clicks: 2

F08 Re-check a revised draft
    S03 -> S04 upload new version -> new report, previous version kept
    happy path clicks: 2 in the clone
    edge: comparing against your own earlier draft (must exclude own versions by default)

F09 Add a document to my library (clone only)
    S17 -> drop file -> indexed
    happy path clicks: 1
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Score badge (similarity) | color bands by % (0 / 1-24 / 25-49 / 50-74 / 75-100) | processing `--`, done, error | S03, S07 |
| AI score badge | % / `*` / not available | processing, done, unavailable | S03, S14 |
| Data table | sortable columns | empty, loading, filled | S03, S12, S17 |
| Upload dropzone | file, paste text | idle, drag-over, uploading, rejected | S04, S17 |
| Document viewer | similarity mode, AI mode | loading, filled | S07, S14 |
| Highlight span | numbered match color per source; cyan, purple (AI) | default, hover, selected, excluded | S07, S14 |
| Side panel with tabs | sources, match groups, flags, filters | open, collapsed | S07 |
| Source card | internet, publication, my library | default, selected, excluded | S08, S12 |
| Match group card | 4 groups | 0 matches, n matches | S09 |
| Split comparison pane | document vs source | filled, source unavailable | S10 |
| Toggle switch | | on, off, disabled | S11 |
| Number input with unit | words / % | valid, invalid | S11 |
| Flag card | hidden text, replaced chars | | S13 |
| Menu / dropdown | | open, closed | S15 |
| Modal | confirm submit, confirm delete | open | S05, S17 |
| Toast | success, error | | all |
| Inline alert | error, info (AI disclaimer) | | S04, S14 |
| Progress indicator | determinate (upload), indeterminate (processing) | | S03, S04 |
| Tooltip | | hover, focus | badges, icons |

## Inferred data model

```
Document      id, title, filename, mime, size_bytes, text (extracted), word_count, page_count,
              language, content_hash, submitted_at, receipt_id, parent_id (previous version),
              in_library (bool)
              evidence: S04, S05, S06 receipt fields, file-limit guides (src 15, 16)
              confidence: high

SimilarityReport  id, document_id, status (queued | processing | done | error), score (0-100),
              settings_id, generated_at, error_message
              evidence: S03 `--` while processing, S07 recalculation on filter change
              confidence: high

ReportSettings  id, exclude_quotes, exclude_bibliography, small_match_words (int, default 8 seen),
              small_match_percent, source_types (internet | publication | library)[]
              evidence: S11, src 2, 4
              confidence: high

Source        id, type (internet | publication | library), title, url, publisher, retrieved_at,
              text or fingerprints
              evidence: S08 source cards with type icons
              confidence: high (fields), guess (storage shape)

ReportSource  report_id, source_id, rank, percent, excluded (bool)
              evidence: S08 ranked list with %, S12 exclusions
              confidence: high

Match         id, report_id, source_id, doc_start, doc_end, source_start, source_end, word_count,
              group (not_cited_or_quoted | missing_quotation | missing_citation | cited_and_quoted),
              in_quote (bool), in_bibliography (bool), excluded (bool)
              evidence: S07 highlights, S09 groups, S10 side by side
              confidence: medium (offsets are a guess at how highlights are stored)

AIReport      id, document_id, status, score (null when < 300 words), qualifying_word_count,
              segments [{start, end, label: ai | ai_paraphrased, probability}], model_version
              evidence: S14, src 7, 8, 9
              confidence: medium

IntegrityFlag id, document_id, type (hidden_text | replaced_characters), start, end, detail
              evidence: S13, src 5, 6
              confidence: high
```

Relationships: Document 1-n Document (versions), Document 1-n SimilarityReport, SimilarityReport n-1 ReportSettings, SimilarityReport 1-n ReportSource n-1 Source, SimilarityReport 1-n Match n-1 Source, Document 1-1 AIReport (latest), Document 1-n IntegrityFlag. Library documents are Sources of type `library`.

Scoring rule (inferred, medium): score = matched words / total words, each document word counted once and given to the highest-ranked source that covers it. That is why excluding a top source can leave the score barely moved (src 2: overlapping sources). Filters remove matches, then the score and ranks are recomputed.

## Feature matrix

See `features.csv`. Must: 16, should: 11, could: 9, skip: 11 (S05 confirm and S06 receipt moved to skip: personal use).

## Out of scope (cannot or should not be cloned)

- **Turnitin's comparison database.** The student-paper repository, the archived web crawl and the licensed publisher content are what make Turnitin's scores what they are. None of it is public. The clone compares against the live web through a search API, open scholarly sources (OpenAlex, arXiv, Crossref abstracts, Semantic Scholar) and the user's own library. Expect lower recall than Turnitin, especially against other students' papers, which the clone will never see.
- **Turnitin's AI detection model.** It is proprietary. The clone gets its own detector (an open-model perplexity method such as Binoculars, or an open-source classifier), and its accuracy will differ from Turnitin's. A low score from the clone does not predict a low score from Turnitin.
- **Classes, assignments, grading, Feedback Studio, LMS integrations.** Not needed for one user.
- **Name, logo, colors, copy.** The clone gets its own name and look.
- **Institution-only features:** official score of record, instructor-only visibility, repository sharing between institutions.

## Size

Screens 14 in the clone (S03-S15, S17), flows 9, entities 8.

Hard parts:
1. **Finding candidate sources without a crawl.** Pick distinctive sentences or shingles from the draft, turn them into web and scholarly search queries, fetch the pages, and stay inside the search API's rate limits and cost. This decides recall.
2. **Alignment and scoring.** Fingerprinting (winnowing over word n-grams) to find candidates fast, then exact span alignment for highlights, then the one-source-per-word ranking and recalculation on every filter change.
3. **AI writing detection.** Running an open model locally or calling one, splitting out prose sentences only, scoring segments, and being honest about false positives.
4. **Text extraction.** PDF and DOCX to clean text with offsets, finding quotes and the bibliography for filters and match groups, and reading DOCX run colors for hidden-text flags.

Size: **M** (a few weeks) for one user. Not a perfect clone: the match database is the product, and it cannot be copied.
