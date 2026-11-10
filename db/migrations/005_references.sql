-- ---------------------------------------------------------------- reference_checks
-- Each entry of a draft's reference list, as the similarity check read it: the title it cites and whether
-- OpenAlex or Crossref has a work by that title. Replaced each time the check runs. A cited work's abstract,
-- when the catalogue has one, also becomes a 'publication' source the draft is aligned against.
create table reference_checks (
  id integer primary key,
  report_id integer not null references similarity_reports(id) on delete cascade,
  start integer not null check (start >= 0),
  "end" integer not null check ("end" > start),
  title text,                                                   -- null when no title could be read
  status text not null check (status in ('found', 'not_found', 'no_title')),
  found_title text,
  found_url text,
  found_year integer,
  check ((status = 'found') = (found_title is not null))
) strict;
create index reference_checks_by_report on reference_checks (report_id, start);

pragma user_version = 5;
