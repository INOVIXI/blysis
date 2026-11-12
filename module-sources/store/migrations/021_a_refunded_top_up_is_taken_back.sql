-- A refunded top-up takes its credits back.
--
-- A refund names the payment by the gateway's own id, and a top-up kept no
-- record of it, so a refund or a chargeback of a top-up found nothing and the
-- credits stayed spendable. The id is written when the top-up settles, and the
-- refund is stamped once so a second notice takes nothing twice.
ALTER TABLE "CreditTopUp" ADD COLUMN IF NOT EXISTS "providerRef" TEXT;
ALTER TABLE "CreditTopUp" ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "CreditTopUp_providerRef_idx" ON "CreditTopUp"("providerRef");
