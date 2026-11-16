-- A product can be sold in variants: a pack of three keys, a rank for six
-- months.
--
-- Three nullable columns. A product with no variants, a basket line with no
-- variant and a chest row bought without one are exactly what every row
-- already is, so nothing sells differently on deploy.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "variants" JSONB;
ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "variantId" TEXT;
ALTER TABLE "ChestItem" ADD COLUMN IF NOT EXISTS "variant" JSONB;
