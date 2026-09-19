-- A trophy can have more than one condition.
--
-- `ruleEvent` and `ruleThreshold` describe exactly one thing that has to
-- happen, so a trophy for somebody who has written ten forum posts *and*
-- bought something could not be described at all.
--
-- Additive and forward-only, and nothing is copied across: a row with these
-- columns null is read as the list of one its old columns already describe.
-- Backfilling would mean writing the same rule in two places and then having
-- to keep them in step.
ALTER TABLE "Trophy" ADD COLUMN IF NOT EXISTS "rules" JSONB;
ALTER TABLE "Trophy" ADD COLUMN IF NOT EXISTS "rulesMode" TEXT DEFAULT 'all';
