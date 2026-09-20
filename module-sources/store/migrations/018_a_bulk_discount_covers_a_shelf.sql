-- A bulk discount covers a shelf, not one thing on it.
--
-- `productId` and `categoryId` held one each, so "buy three of any rank" was
-- sayable and "any of these three ranks" was not. Worse, the matcher read
-- them as an either-or: a rule naming a product AND a category covered every
-- product in that category as well as that one product, which is not a
-- sentence anybody was trying to write.
--
-- Two lists, the same shape a coupon now carries, matched by the same
-- function.
--
-- Destructive, and what is lost is nothing: the two old columns are copied
-- into the new lists first, row by row, and only then dropped. A rule naming
-- neither had two nulls and gets two empty lists, which is the same rule -
-- it covers everything either way. The columns are dropped rather than left
-- because a second way to say where a rule applies is a second answer for
-- the matcher to disagree with.
ALTER TABLE "BulkDiscount" ADD COLUMN IF NOT EXISTS "productIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "BulkDiscount" ADD COLUMN IF NOT EXISTS "categoryIds" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "BulkDiscount"
   SET "productIds" = ARRAY["productId"]
 WHERE "productId" IS NOT NULL AND cardinality("productIds") = 0;

UPDATE "BulkDiscount"
   SET "categoryIds" = ARRAY["categoryId"]
 WHERE "categoryId" IS NOT NULL AND cardinality("categoryIds") = 0;

DROP INDEX IF EXISTS "BulkDiscount_productId_idx";
DROP INDEX IF EXISTS "BulkDiscount_categoryId_idx";
ALTER TABLE "BulkDiscount" DROP COLUMN IF EXISTS "productId";
ALTER TABLE "BulkDiscount" DROP COLUMN IF EXISTS "categoryId";
