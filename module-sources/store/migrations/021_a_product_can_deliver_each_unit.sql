-- A product can run its delivery commands once for every unit bought.
--
-- A product's commands ran once per order line whatever its quantity, so a
-- command that hands out a fixed amount delivered one lot to a buyer who paid
-- for three. The column defaults to false, which is what every existing
-- product already did: nothing delivers differently on deploy.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "commandsPerUnit" BOOLEAN NOT NULL DEFAULT false;
