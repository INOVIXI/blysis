-- Where a rule applies, as the operator divides it up.
--
-- The record had one idea of "where": which module reported it, which answers
-- a different question. One site runs Survival and Skyblock off the same
-- server and wants them apart on the list; another runs a Minecraft server and
-- a CS:GO server; and nearly everyone wants a ban handed down in a game kept
-- apart from what this website itself does about it.
--
-- `restrictsSite` is that last part and it defaults to false, so creating a
-- scope never quietly closes anybody's account here. Every row already in the
-- table stays unscoped, and an unscoped punishment goes on restricting - which
-- is what those rows have always done and what an administrator issuing one
-- here means.
--
-- `scopeKey` is what the reporter called the place, kept whether or not a
-- scope claims it. It is the other system's word, so it is never shown; it is
-- here so a scope made later can claim the rows that were waiting for it.
--
-- Additive and forward-only. Nothing is lost.

CREATE TABLE IF NOT EXISTS "PunishmentScope" (
    "id"            TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "matchKey"      TEXT,
    "restrictsSite" BOOLEAN NOT NULL DEFAULT false,
    "order"         INTEGER NOT NULL DEFAULT 0,
    "isActive"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PunishmentScope_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PunishmentScope_matchKey_key" ON "PunishmentScope"("matchKey");
CREATE INDEX IF NOT EXISTS "PunishmentScope_isActive_order_idx" ON "PunishmentScope"("isActive", "order");

ALTER TABLE "Punishment" ADD COLUMN IF NOT EXISTS "scopeId" TEXT;
ALTER TABLE "Punishment" ADD COLUMN IF NOT EXISTS "scopeKey" TEXT;

CREATE INDEX IF NOT EXISTS "Punishment_scopeId_idx" ON "Punishment"("scopeId");
CREATE INDEX IF NOT EXISTS "Punishment_scopeKey_idx" ON "Punishment"("scopeKey");

DO $$
BEGIN
    ALTER TABLE "Punishment"
        ADD CONSTRAINT "Punishment_scopeId_fkey"
        FOREIGN KEY ("scopeId") REFERENCES "PunishmentScope"("id") ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
