-- ---------------------------------------------------------------- documents.layout
-- How a DOCX looks, for the report viewer: headings, paragraphs, list items, tables and pictures in order,
-- each pointing at its text in documents.text by [start, end] offsets (worker/extract.py, _Layout).
-- Pictures are files in data/uploads/{id}/media/, named in the blocks. Null for pasted text and other
-- file types: the viewer then shows the plain text.
alter table documents add column layout text check (layout is null or json_valid(layout));

pragma user_version = 3;
