-- ---------------------------------------------------------------- resolutions
-- What the owner decided about each flagged passage in a draft: a similarity match quoted and cited,
-- or rewritten; an AI-like passage rewritten, or kept as written. Keyed by the passage's text range,
-- not a match id, because a rescore replaces match rows while the draft's text (and so the range) stays.
-- Excluding a match is not a resolution: it lives on matches.excluded and changes the score.
create table resolutions (
  id integer primary key,
  document_id integer not null references documents(id) on delete cascade,
  kind text not null check (kind in ('match', 'ai')),
  start integer not null check (start >= 0),
  "end" integer not null check ("end" > start),
  state text not null check (state in ('cited', 'rewritten', 'kept')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check (kind = 'ai' or state <> 'kept'),
  check (kind = 'match' or state <> 'cited'),
  unique (document_id, kind, start, "end")
) strict;

pragma user_version = 4;
