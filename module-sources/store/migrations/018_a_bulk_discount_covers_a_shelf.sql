-- supersedes-checksum: f068772bbc33e370d4e727c391a5d74338da9976dcd544ab91bdbc54bdf5bbd0
-- (the text before the column guards, which failed every fresh install with
-- 42703 column "productId" does not exist; see supersededChecksums in
-- scripts/apply-migrations.ts)
--
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
--
-- On a fresh install the reconcile has already made the final shape: the
-- lists are there and the old columns never were, so the copies only run
-- where a column is still there to copy from.
ALTER TABLE "BulkDiscount" ADD COLUMN IF NOT EXISTS "productIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "BulkDiscount" ADD COLUMN IF NOT EXISTS "categoryIds" TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'BulkDiscount' AND column_name = 'productId') THEN
        UPDATE "BulkDiscount"
           SET "productIds" = ARRAY["productId"]
         WHERE "productId" IS NOT NULL AND cardinality("productIds") = 0;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'BulkDiscount' AND column_name = 'categoryId') THEN
        UPDATE "BulkDiscount"
           SET "categoryIds" = ARRAY["categoryId"]
         WHERE "categoryId" IS NOT NULL AND cardinality("categoryIds") = 0;
    END IF;
END $$;

DROP INDEX IF EXISTS "BulkDiscount_productId_idx";
DROP INDEX IF EXISTS "BulkDiscount_categoryId_idx";
ALTER TABLE "BulkDiscount" DROP COLUMN IF EXISTS "productId";
ALTER TABLE "BulkDiscount" DROP COLUMN IF EXISTS "categoryId";
