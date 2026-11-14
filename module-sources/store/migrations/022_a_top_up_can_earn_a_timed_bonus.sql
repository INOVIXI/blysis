-- A top-up can earn a bonus for a limited time.
--
-- An operator wants to say "this weekend, pay 250 or more and get 10% more
-- credits". A package's own bonus is fixed and has no end date, so it cannot
-- say this. A campaign has a start, an end and tiers of minimum payment and
-- percent.
--
-- The bonus is decided when the payment starts and written on the top-up, so
-- a campaign that ends while a gateway is still settling pays what the buyer
-- was shown. `bonusCampaignId` is a plain id with no foreign key: a deleted
-- campaign must not change a payment that was already started.
--
-- Additive. A shop with no campaign behaves exactly as before.
CREATE TABLE IF NOT EXISTS "CreditBonusCampaign" (
  "id"        TEXT PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "startsAt"  TIMESTAMP(3) NOT NULL,
  "endsAt"    TIMESTAMP(3) NOT NULL,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "tiers"     JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "CreditBonusCampaign_isActive_endsAt_idx" ON "CreditBonusCampaign"("isActive", "endsAt");

ALTER TABLE "CreditTopUp" ADD COLUMN IF NOT EXISTS "bonusCredits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CreditTopUp" ADD COLUMN IF NOT EXISTS "bonusCampaignId" TEXT;
