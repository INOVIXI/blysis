-- A table can be about something the site already has.
--
-- `subjectRef` names it - `store.category:<id>` today - and `sourceRef` says
-- which thing inside that subject each column is. Both are opaque strings on
-- purpose: this module never learns what a product is, it asks whoever minted
-- the reference.
--
-- Both are nullable and default to nothing, so every table that exists keeps
-- working exactly as it did: typed columns, no subject, its own page.
ALTER TABLE "ComparisonTable" ADD COLUMN IF NOT EXISTS "subjectRef" TEXT;
ALTER TABLE "ComparisonColumn" ADD COLUMN IF NOT EXISTS "sourceRef" TEXT;

-- One table per subject: two would be two answers to the same question, and
-- the category page would have to choose between them.
CREATE UNIQUE INDEX IF NOT EXISTS "ComparisonTable_subjectRef_key" ON "ComparisonTable"("subjectRef");

-- One column per thing, within a table. The reconcile below relies on it:
-- it upserts a column per source and would otherwise grow a second every time
-- two of them raced.
CREATE UNIQUE INDEX IF NOT EXISTS "ComparisonColumn_tableId_sourceRef_key" ON "ComparisonColumn"("tableId", "sourceRef");
