-- A creator's code says what it is for.
--
-- The percentage came off the whole basket whatever the code was written
-- for, so a code made for one creator's own cosmetic line discounted the
-- ranks, the keys and the gift cards beside them - and the commission was
-- worked out from the same number, so the creator was paid for sales that
-- had nothing to do with them.
--
-- Two lists, the shape a coupon and a bulk discount now carry, matched by
-- the same function. Empty is every product, which is what every code
-- already issued meant, so nothing in the wild changes.
--
-- No foreign key, matching the rules beside it: a product an operator
-- deletes should narrow the code, not refuse the delete.
ALTER TABLE "CreatorCode" ADD COLUMN IF NOT EXISTS "productIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "CreatorCode" ADD COLUMN IF NOT EXISTS "categoryIds" TEXT[] NOT NULL DEFAULT '{}';
