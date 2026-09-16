-- A member may change the address on their account, and the new one proves
-- itself first.
--
-- Until now they could not change it at all, so there was nowhere to hold an
-- address somebody had asked for but not yet answered on. Writing it straight
-- onto the account is the shape that breaks quietly: a typo moves every future
-- password reset to a mailbox nobody reads, and a deliberate one moves it to
-- somebody else's. The reset link is the account.
--
-- One live request per member, which is what the unique key on `userId` says.
-- Asking again replaces the row, so a link somebody mailed themselves twice
-- cannot be spent on the older address.
--
-- Additive: a new table, nothing touched.

CREATE TABLE IF NOT EXISTS "EmailChange" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "newEmail"  TEXT NOT NULL,
    "token"     TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailChange_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmailChange_userId_fkey') THEN
        ALTER TABLE "EmailChange"
            ADD CONSTRAINT "EmailChange_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "EmailChange_userId_key" ON "EmailChange"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "EmailChange_token_key" ON "EmailChange"("token");
CREATE INDEX IF NOT EXISTS "EmailChange_expiresAt_idx" ON "EmailChange"("expiresAt");
