-- supersedes-checksum: d4ff127622748248f7d53f504d0e99cd8c97c1f2824d5c7975cbcf4fa4c2ddf5
-- (the text whose guard looked only at pg_constraint; see below)
--
-- An order needs a number, not only a name.
--
-- `Order.id` is a cuid and `orderNumber` is a string the buyer sees. Both are
-- fine for this shop and neither is an integer, which is what a pulling
-- integrator's schema asks for: it takes `OrderId` from the list it fetches
-- and hands the same value back when it has issued the document, so the number
-- has to be an integer AND has to lead back to one row. A hash would satisfy
-- the first and not the second.
--
-- Additive, and the same shape `Product.number` already has in this module: a
-- sequence fills it for the rows that exist, so an order placed before this
-- migration is reachable by the integrator too.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "number" SERIAL;

-- The guard asks for the name as a relation too. A fresh install gets the
-- column from the merged schema, where `@unique` makes Prisma create a unique
-- INDEX called Order_number_key rather than a constraint, so a check on
-- pg_constraint alone missed it and the ADD failed with 42P07.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Order_number_key'
    ) AND to_regclass('"Order_number_key"') IS NULL THEN
        ALTER TABLE "Order" ADD CONSTRAINT "Order_number_key" UNIQUE ("number");
    END IF;
END $$;
