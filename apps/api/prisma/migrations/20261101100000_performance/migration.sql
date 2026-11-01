-- Final session, part A: indexes and generated columns found with the volume seed (docs/PROGRESS.md).

-- Workspace search: processes had their tsvector computed for every row on every query.
ALTER TABLE "Process" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english'::regconfig, "nameEn"), 'A') ||
    setweight(to_tsvector('arabic'::regconfig, "nameAr"), 'A') ||
    setweight(to_tsvector('english'::regconfig, "descriptionEn"), 'B') ||
    setweight(to_tsvector('arabic'::regconfig, "descriptionAr"), 'B')
) STORED;
CREATE INDEX "Process_searchVector_idx" ON "Process" USING GIN ("searchVector");
