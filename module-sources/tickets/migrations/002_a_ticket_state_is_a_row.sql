-- What state a ticket is in becomes the operator's vocabulary.
--
-- Five statuses and four priorities were Prisma enums - database types - so
-- "operator-defined" was not a setting anybody could ship: adding a value
-- meant a migration. A desk that triages into "First line" and "With the
-- developers" could not say so, and one that never resolves anything could
-- not take RESOLVED away.
--
-- Two tables and two plain columns. The two flags on a status are the facts
-- three files used to state as `status = 'CLOSED' OR status = 'RESOLVED'`:
-- whether a ticket in it is still being worked on, and whether moving a
-- ticket there stamps the day it was finished.
--
-- Destructive in one respect and nothing is lost: the columns change type
-- from the enum to text, holding exactly the strings they already held, and
-- the two enum types are dropped once nothing refers to them. Every ticket
-- keeps the state it was in, and the five and four rows seeded below carry
-- the same keys, so every screen reads what it read before.
-- The columns first. A Postgres enum type and a table share one namespace,
-- so `TicketStatus` cannot be a table until it has stopped being a type, and
-- it cannot stop being a type while a column is declared as one.
ALTER TABLE "Ticket" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Ticket" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "Ticket" ALTER COLUMN "status" SET DEFAULT 'OPEN';

ALTER TABLE "Ticket" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "Ticket" ALTER COLUMN "priority" TYPE TEXT USING "priority"::TEXT;
ALTER TABLE "Ticket" ALTER COLUMN "priority" SET DEFAULT 'MEDIUM';

DROP TYPE IF EXISTS "TicketStatus";
DROP TYPE IF EXISTS "TicketPriority";

CREATE TABLE IF NOT EXISTS "TicketStatus" (
    "id"           TEXT PRIMARY KEY,
    "key"          TEXT NOT NULL,
    "name"         TEXT,
    "nameKey"      TEXT,
    "tone"         TEXT NOT NULL DEFAULT 'neutral',
    "isOpen"       BOOLEAN NOT NULL DEFAULT TRUE,
    "closesTicket" BOOLEAN NOT NULL DEFAULT FALSE,
    "order"        INTEGER NOT NULL DEFAULT 0,
    "isActive"     BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "TicketStatus_key_key" ON "TicketStatus"("key");
CREATE INDEX IF NOT EXISTS "TicketStatus_isActive_order_idx" ON "TicketStatus"("isActive", "order");

CREATE TABLE IF NOT EXISTS "TicketPriority" (
    "id"        TEXT PRIMARY KEY,
    "key"       TEXT NOT NULL,
    "name"      TEXT,
    "nameKey"   TEXT,
    "tone"      TEXT NOT NULL DEFAULT 'neutral',
    "order"     INTEGER NOT NULL DEFAULT 0,
    "isActive"  BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "TicketPriority_key_key" ON "TicketPriority"("key");
CREATE INDEX IF NOT EXISTS "TicketPriority_isActive_order_idx" ON "TicketPriority"("isActive", "order");
