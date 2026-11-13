-- A product can leave a paid purchase in the buyer's chest until they claim it.
--
-- A paid order ran its delivery commands at once, so a buyer who was offline,
-- on the wrong server or not ready for the items had them run anyway. The
-- column defaults to 'inherit', and the shop's setting it inherits defaults to
-- delivering at once, which is what every existing product already did:
-- nothing delivers differently on deploy.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "deliveryMode" TEXT NOT NULL DEFAULT 'inherit';
