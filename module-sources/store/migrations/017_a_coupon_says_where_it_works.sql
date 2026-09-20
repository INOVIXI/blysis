-- A coupon says which shelf it is for.
--
-- Every coupon came off the whole basket, so "20% off the ranks this weekend"
-- could not be said at all: the code came off the hats and the gift cards
-- too. Two lists rather than one column, because a one-product coupon is
-- nearly useless and an operator running an offer means a shelf.
--
-- Empty is every product, which is what every coupon already written meant,
-- so nothing already issued changes.
--
-- No foreign key on purpose, matching `BulkDiscount` beside it: a product an
-- operator deletes should narrow the offer, not refuse the delete or cascade
-- into the coupon. An id left behind simply matches nothing.
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "productIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "categoryIds" TEXT[] NOT NULL DEFAULT '{}';
