-- A module's record can carry its text in more than one language.
--
-- A product name, an announcement or a page was one string, shown to every
-- reader in whatever language the admin typed it. The string stays where it
-- is, as the original, so search, sorting, exports and every API that reads
-- the column are untouched; a translation of one field of one record into one
-- language is a row here, written and read by the module through the SDK.
--
-- One table in core rather than a column per field in every module, so a
-- module adopts it with a field declaration and no migration of its own, and
-- the rows already written need nothing done to them.
--
-- The unique key is what a save replaces against. The second index is the
-- read: a page of records asks for every translation of those records at once.
--
-- Additive: a new table, nothing touched.

CREATE TABLE IF NOT EXISTS "ContentTranslation" (
    "id"        TEXT NOT NULL,
    "owner"     TEXT NOT NULL,
    "entity"    TEXT NOT NULL,
    "recordId"  TEXT NOT NULL,
    "field"     TEXT NOT NULL,
    "locale"    TEXT NOT NULL,
    "text"      TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContentTranslation_owner_entity_recordId_field_locale_key"
    ON "ContentTranslation" ("owner", "entity", "recordId", "field", "locale");

CREATE INDEX IF NOT EXISTS "ContentTranslation_owner_entity_recordId_idx"
    ON "ContentTranslation" ("owner", "entity", "recordId");
