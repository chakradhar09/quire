-- ---------------------------------------------------------------- figures
-- The perceptual hash (worker/figures.py) of each picture in an uploaded DOCX or PDF, in document order,
-- so a figure that also appears in another of your uploads can be shown. Written by the extract job;
-- the pictures and hashes never leave the PC.
create table figures (
  id integer primary key,
  document_id integer not null references documents(id) on delete cascade,
  ordinal integer not null check (ordinal >= 1),                    -- 1 = the draft's first picture
  hash text not null check (length(hash) = 16),                     -- 64 bits as hex
  unique (document_id, ordinal)
) strict;

pragma user_version = 2;
