-- The browser's PDF viewer reads a large paper a part at a time. Stored without Postgres's own
-- compression (a PDF is compressed already), a part can be fetched without unpacking the whole
-- file first. Applies to papers added from now on; the ones already stored read as before.
ALTER TABLE paper_files ALTER COLUMN data SET STORAGE EXTERNAL;
