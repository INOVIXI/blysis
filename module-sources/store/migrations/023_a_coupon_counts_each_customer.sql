-- A coupon counts each customer.
--
-- A coupon only had one cap, across every buyer, so one player could use a
-- code meant for everybody once until the cap ran out. A coupon now says how
-- many orders one customer may place with it, and an order says which coupon
-- it was placed with, so the uses are counted from the orders themselves: a
-- refunded or cancelled order stops counting and gives its use back.
--
-- No default and no backfill on purpose. An existing code may be meant to be
-- used again and again by the same people, a standing "10% off the shop" for
-- example, and limiting it to one use each would change an offer the operator
-- already published. Null means no limit, which is what every coupon already
-- written meant. A coupon made in the panel from now on starts at one.
--
-- Orders placed before this carry no coupon, so they are not counted.
--
-- No foreign key, matching migration 017: deleting a coupon must not refuse
-- or cascade into the orders that used it.
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "perCustomerLimit" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "couponId" TEXT;
CREATE INDEX IF NOT EXISTS "Order_couponId_userId_idx" ON "Order"("couponId", "userId");
