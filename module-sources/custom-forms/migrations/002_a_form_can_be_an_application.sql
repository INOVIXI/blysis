-- A form can be an application.
--
-- An operator can ask that only signed-in members send a form, cap how many
-- times one member may send it, and start the count again. A submission can
-- carry a note to the person who sent it, which they read beside the
-- decision.
--
-- Every column is new and has a default or is nullable, so a form saved
-- before this keeps behaving as it did: anyone may send it, as often as they
-- like. A null `limitPeriodStart` means every submission counts; resetting
-- the allowances sets it, and the submissions before it stay.
--
-- The indexes are what the allowance count and a member's own list read by.
--
-- Safe on a fresh install and safe to re-run.

ALTER TABLE "CustomForm" ADD COLUMN IF NOT EXISTS "requireSignIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomForm" ADD COLUMN IF NOT EXISTS "submissionLimit" INTEGER;
ALTER TABLE "CustomForm" ADD COLUMN IF NOT EXISTS "limitPeriodStart" TIMESTAMP(3);

ALTER TABLE "CustomFormSubmission" ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;
ALTER TABLE "CustomFormSubmission" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "CustomFormSubmission_formId_userId_createdAt_idx"
    ON "CustomFormSubmission" ("formId", "userId", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomFormSubmission_userId_createdAt_idx"
    ON "CustomFormSubmission" ("userId", "createdAt");
