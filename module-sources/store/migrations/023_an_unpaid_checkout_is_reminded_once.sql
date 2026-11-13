-- An unpaid checkout can be reminded about, once.
--
-- An order or a credit top-up a buyer started and never paid for stayed
-- PENDING with nothing following it up. The reminder sweep claims a row by
-- setting `remindedAt` on it while it is still null, so a checkout is never
-- reminded twice, however many sweeps overlap. Null on every existing row,
-- and the sweep only looks at the last few days, so switching the reminder on
-- does not write to everybody who ever left a basket.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "remindedAt" TIMESTAMP(3);
ALTER TABLE "CreditTopUp" ADD COLUMN IF NOT EXISTS "remindedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "CreditTopUp_status_createdAt_idx" ON "CreditTopUp"("status", "createdAt");
