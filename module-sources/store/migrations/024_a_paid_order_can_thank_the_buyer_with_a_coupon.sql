-- A paid order can thank its buyer with a coupon only they may redeem.
--
-- Two nullable columns: who the coupon is for, and the order it was minted
-- for. Every existing coupon has neither, which is what it already meant: a
-- code anybody may use, issued by hand. The order column is unique because one
-- order mints at most one coupon, and a settlement that is delivered twice
-- has to find the first one rather than make another.
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "issuedForOrderId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Coupon_issuedForOrderId_key" ON "Coupon"("issuedForOrderId");
