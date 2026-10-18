-- A ranking of top-ups reads one kind of ledger entry over a window of
-- time, across every member. The (userId, createdAt) index cannot answer
-- that, so it gets its own.
--
-- Safe on a fresh install, where the schema already created it, and safe to
-- re-run.

CREATE INDEX IF NOT EXISTS "CreditTransaction_type_createdAt_idx"
    ON "CreditTransaction" ("type", "createdAt");
