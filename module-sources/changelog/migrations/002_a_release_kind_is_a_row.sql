-- A kind of release is a row an operator can add to.
--
-- Six were written into the module as an array, with a colour and a
-- translation key each. Six is not every community's six, and none of the six
-- could be removed either.
--
-- Additive: `ChangelogEntry.type` still holds the kind's key as a string
-- rather than pointing at a row. Deleting a kind is the thing that was asked
-- for, and a foreign key would make it either impossible or destructive - a
-- release written under a kind that has since gone prints its key, which is
-- what the label already did for an unknown one.
CREATE TABLE IF NOT EXISTS "ChangelogType" (
    "id"        TEXT PRIMARY KEY,
    "key"       TEXT NOT NULL,
    "name"      TEXT,
    "nameKey"   TEXT,
    "tone"      TEXT NOT NULL DEFAULT 'neutral',
    "order"     INTEGER NOT NULL DEFAULT 0,
    "isActive"  BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ChangelogType_key_key" ON "ChangelogType"("key");
CREATE INDEX IF NOT EXISTS "ChangelogType_isActive_order_idx" ON "ChangelogType"("isActive", "order");
