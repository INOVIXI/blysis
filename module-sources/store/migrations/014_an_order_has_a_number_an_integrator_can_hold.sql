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

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Order_number_key'
    ) THEN
        ALTER TABLE "Order" ADD CONSTRAINT "Order_number_key" UNIQUE ("number");
    END IF;
END $$;
