-- Where the last read of the game server's database got to.
--
-- This module used to hold an endpoint waiting for a LiteBans server to POST
-- a punishment to it, in a JSON shape this repository invented. Checked
-- against LiteBans 2.19.0 itself: it does post over HTTP, but what it posts is
-- a Discord embed whose body is the prose in messages.yml - "$playerName has
-- been banned!" - with no id, no UUID and no timestamps in it. Nothing it can
-- say identifies a row, so nothing it sends could ever have been recorded.
--
-- What LiteBans does publish for a machine is its SQL database and a Java API
-- (litebans.api.Entry carries id, type, uuid, ip, reason, executor, removedBy,
-- dateStart, dateEnd, serverScope, silent, ipban, active).
--
-- So the punishments are read out of the database instead, on the scheduler,
-- and a read has to know where the last one stopped. LiteBans numbers each of
-- its four punishment tables on its own - which is why its own API has
-- getBan(id), getMute(id), getWarning(id) and getKick(id) rather than one
-- lookup - so there is a cursor per kind.
--
-- The key is the kind rather than the table name, so an operator who renames
-- their LiteBans tables keeps their place instead of re-reading everything.
--
-- Additive and forward-only. Nothing is lost by an install that never had the
-- table: a missing cursor reads as zero, which is a first run.

CREATE TABLE IF NOT EXISTS "LiteBansSync" (
    "kind"     TEXT NOT NULL,
    "lastId"   BIGINT NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiteBansSync_pkey" PRIMARY KEY ("kind")
);
