-- A lifted punishment says who lifted it and why.
--
-- The record held only `active`, so an appeal upheld and a ban that simply ran
-- out looked the same on the screen a member reads about themselves. The game
-- server knew: LiteBans carries `removedByName` and `removalReason` on every
-- entry, and an administrator revoking one here types a reason into a form.
-- Neither had anywhere to go.
--
-- Additive and forward-only. Every row already here keeps its meaning: a
-- punishment lifted before this column existed has no name against it, which
-- is the same thing the column says for one lifted by a system that does not
-- report who did it.

ALTER TABLE "Punishment" ADD COLUMN IF NOT EXISTS "liftedBy" TEXT;
ALTER TABLE "Punishment" ADD COLUMN IF NOT EXISTS "liftReason" TEXT;
