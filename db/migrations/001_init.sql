-- Quire schema, SQLite 3.37+ (STRICT tables). First migration: db/migrations/001_init.sql.
-- One file, data/quire.db, shared by the web app (node:sqlite) and the worker (Python sqlite3).
--
-- No users and no auth: the app runs on 127.0.0.1 for its one owner. Nothing here is per-user.
--
-- Every connection, web and worker, must run these first. foreign_keys is OFF by default in
-- SQLite, and without it none of the ON DELETE rules below happen:
--   PRAGMA foreign_keys = ON;
--   PRAGMA journal_mode = WAL;      -- web reads while the worker writes
--   PRAGMA busy_timeout = 5000;     -- wait for the other writer instead of failing
--
-- Conventions:
--   ids       INTEGER PRIMARY KEY (rowid)
--   times     TEXT, UTC ISO-8601 'YYYY-MM-DDTHH:MM:SS.SSSZ'. Write them with the NOW expression
--             below in SQL, never from app clocks, so they compare correctly as text.
--   booleans  INTEGER 0 or 1
--   json      TEXT checked with json_valid
--   offsets   character offsets into the normalized text in documents.text / sources.text

-- NOW = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))

-- ---------------------------------------------------------------- documents
-- An uploaded or pasted draft, or a library document.
create table documents (
  id integer primary key,
  parent_id integer references documents(id) on delete set null,   -- previous version (F08)
  title text not null check (length(title) between 1 and 300),
  filename text,                                                    -- null for pasted text
  file_path text,                                                   -- data/uploads/{id}/{filename}
  mime text,
  size_bytes integer check (size_bytes between 1 and 52428800),     -- 50 MB
  status text not null default 'extracting'
    check (status in ('extracting', 'ready', 'rejected')),            -- ready = text extracted, checks queued
  reject_reason text
    check (reject_reason in ('too_few_words', 'image_only_pdf', 'too_large', 'too_many_pages',
                             'unsupported_type', 'extraction_failed')),
  text text,                                                        -- raw paste until extract, then normalized
  word_count integer check (word_count >= 0),
  page_count integer check (page_count >= 0),
  language text,                                                    -- ISO 639-1, detected
  quote_spans text not null default '[]'
    check (json_valid(quote_spans) and json_type(quote_spans) = 'array'),  -- [[start,end],...]
  bibliography_start integer check (bibliography_start >= 0),       -- null = no reference list found
  content_hash text,                                                -- sha256 of text
  in_library integer not null default 0 check (in_library in (0, 1)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check ((status = 'rejected') = (reject_reason is not null)),
  check (file_path is not null or filename is null)
) strict;
create index documents_by_created on documents (created_at desc);
create index documents_by_parent on documents (parent_id);
create index documents_in_library on documents (id) where in_library = 1;

-- ---------------------------------------------------------------- sources
-- Anything a draft can match: a fetched web page, a scholarly record, or a library document.
-- Cached so a source fetched once is reused by later checks.
create table sources (
  id integer primary key,
  type text not null check (type in ('internet', 'publication', 'library')),
  document_id integer references documents(id) on delete cascade,  -- library sources only
  url text,
  title text,
  publisher text,
  text text not null,                                               -- normalized like documents.text
  text_hash text not null,
  fetched_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check ((type = 'library') = (document_id is not null)),
  check (type = 'library' or url is not null)
) strict;
create unique index sources_by_url on sources (url) where url is not null;
create unique index sources_by_document on sources (document_id) where document_id is not null;
create index sources_by_fetched on sources (fetched_at);

-- ---------------------------------------------------------------- fingerprints
-- Winnowed word 5-gram hashes (signed 64-bit) of library sources: one indexed lookup finds
-- library candidates for a new draft. Web sources are fingerprinted in worker memory only.
create table fingerprints (
  id integer primary key,
  source_id integer not null references sources(id) on delete cascade,
  hash integer not null,
  word_pos integer not null check (word_pos >= 0)
) strict;
create index fingerprints_by_hash on fingerprints (hash);
create index fingerprints_by_source on fingerprints (source_id);

-- ---------------------------------------------------------------- similarity_reports
-- One per checked document, created by the extract job when the text is ready. Filter settings live on the report (S11).
create table similarity_reports (
  id integer primary key,
  document_id integer not null unique references documents(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'recalculating', 'done', 'error')),
  score real check (score between 0 and 100),                       -- null until done
  exclude_quotes integer not null default 0 check (exclude_quotes in (0, 1)),
  exclude_bibliography integer not null default 0 check (exclude_bibliography in (0, 1)),
  small_match_words integer not null default 0 check (small_match_words between 0 and 1000),
  small_match_percent real not null default 0 check (small_match_percent between 0 and 100),
  source_types text not null default '["internet","publication","library"]'
    check (json_valid(source_types) and json_type(source_types) = 'array'),
  exclude_own_versions integer not null default 1 check (exclude_own_versions in (0, 1)),
  queries_used integer not null default 0 check (queries_used >= 0),  -- search API budget spent
  error text,
  generated_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check (status <> 'done' or score is not null)
) strict;
create index similarity_reports_by_status on similarity_reports (status);

-- ---------------------------------------------------------------- report_sources
-- The ranked list on S08. Rank and percent are rewritten by every rescore.
create table report_sources (
  id integer primary key,
  report_id integer not null references similarity_reports(id) on delete cascade,
  source_id integer not null references sources(id) on delete cascade,
  rank integer check (rank >= 1),                                   -- null when hidden, excluded or fully overlapped
  percent real not null default 0 check (percent between 0 and 100),
  matched_words integer not null default 0 check (matched_words >= 0),
  excluded integer not null default 0 check (excluded in (0, 1)),   -- your choice (F04)
  unique (report_id, source_id)
) strict;
create index report_sources_by_rank on report_sources (report_id, rank);
create index report_sources_by_source on report_sources (source_id);

-- ---------------------------------------------------------------- matches
-- One aligned span between the draft and a source.
create table matches (
  id integer primary key,
  report_id integer not null references similarity_reports(id) on delete cascade,
  source_id integer not null references sources(id) on delete cascade,
  doc_start integer not null check (doc_start >= 0),
  doc_end integer not null,
  src_start integer not null check (src_start >= 0),
  src_end integer not null,
  word_count integer not null check (word_count > 0),
  match_group text not null
    check (match_group in ('not_cited_or_quoted', 'missing_quotation', 'missing_citation', 'cited_and_quoted')),
  in_quote integer not null default 0 check (in_quote in (0, 1)),
  in_bibliography integer not null default 0 check (in_bibliography in (0, 1)),
  excluded integer not null default 0 check (excluded in (0, 1)),   -- you excluded this one match
  hidden_reason text                                                -- set by rescore; null = counted and shown
    check (hidden_reason in ('quote', 'bibliography', 'small_source', 'source_type',
                             'source_excluded', 'match_excluded', 'own_version')),
  check (doc_end > doc_start),
  check (src_end > src_start)
) strict;
create index matches_by_position on matches (report_id, doc_start);
create index matches_by_source on matches (source_id);

-- ---------------------------------------------------------------- ai_reports
create table ai_reports (
  id integer primary key,
  document_id integer not null unique references documents(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'done', 'unavailable', 'error')),
  unavailable_reason text
    check (unavailable_reason in ('too_few_words', 'unsupported_language')),
  score real check (score between 0 and 100),                       -- UI shows * when 0 < score < 20
  qualifying_words integer check (qualifying_words >= 0),           -- prose sentences only
  segments text not null default '[]'
    check (json_valid(segments) and json_type(segments) = 'array'), -- [{start, end, label, p}]
  model text,                                                       -- detector + model pair + threshold version
  error text,
  generated_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check ((status = 'unavailable') = (unavailable_reason is not null)),
  check (status <> 'done' or score is not null)
) strict;

-- ---------------------------------------------------------------- integrity_flags
create table integrity_flags (
  id integer primary key,
  document_id integer not null references documents(id) on delete cascade,
  type text not null check (type in ('hidden_text', 'replaced_characters')),
  doc_start integer not null check (doc_start >= 0),
  doc_end integer not null,
  detail text not null default '{}'
    check (json_valid(detail) and json_type(detail) = 'object'),    -- {original, replacement, script} or {color}
  check (doc_end > doc_start)
) strict;
create index integrity_flags_by_position on integrity_flags (document_id, doc_start);

-- ---------------------------------------------------------------- jobs
-- The queue. Exactly one target: a document (extract, ai, index_library) or a report
-- (similarity, rescore). Real foreign keys, so deleting a draft deletes its jobs.
create table jobs (
  id integer primary key,
  kind text not null check (kind in ('extract', 'similarity', 'rescore', 'ai', 'index_library')),
  document_id integer references documents(id) on delete cascade,
  report_id integer references similarity_reports(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  run_after text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  locked_at text,
  error text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check ((document_id is null) <> (report_id is null)),
  check ((kind in ('similarity', 'rescore')) = (report_id is not null))
) strict;
-- At most one queued job per (kind, target): double clicks and repeated filter changes collapse.
-- Insert with ON CONFLICT DO NOTHING (never INSERT OR IGNORE, which also swallows CHECK failures).
create unique index jobs_one_queued_document on jobs (kind, document_id) where status = 'queued' and document_id is not null;
create unique index jobs_one_queued_report on jobs (kind, report_id) where status = 'queued' and report_id is not null;
create index jobs_by_status on jobs (status, run_after);

pragma user_version = 1;

-- Worker claim (one worker, so jobs never overlap and no per-target guard is needed):
--   BEGIN IMMEDIATE;
--   UPDATE jobs SET status = 'running', locked_at = NOW, attempts = attempts + 1
--    WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= NOW
--                ORDER BY created_at, id LIMIT 1)
--   RETURNING *;
--   COMMIT;
-- ponytail: one worker means jobs run one at a time. A second worker needs a per-target
-- guard in the claim (skip targets with a running job).
--
-- No confirm step and no receipt (personal use: nothing is submitted to anyone). When the
-- extract job succeeds, the worker in the same transaction sets the document 'ready', inserts
-- both reports, and queues 'similarity' (report) and 'ai' (document).
--
-- Other writes are short transactions in the web app (web/lib/db.ts), each in BEGIN IMMEDIATE ... COMMIT:
--   submitText(title, text)        insert the document ('extracting') and queue 'extract'
--   requestRescore(reportId)       done|recalculating -> recalculating, queue 'rescore'
--   setInLibrary(documentId, on)   on: queue 'index_library'; off: delete that source's fingerprints
--   deleteDocument(documentId)     collect other reports that matched it as a library source,
--                                  delete the row (cascades), mark those reports recalculating,
--                                  queue 'rescore' for each; then remove data/uploads/{id}/
--   retryReport(reportId)          error -> queued, queue 'similarity'
