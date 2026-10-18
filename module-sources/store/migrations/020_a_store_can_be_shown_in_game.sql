-- A shop a game can show, and a gift that waits to be accepted.
--
-- A game server that connects to the site itself draws the shop in game and
-- delivers through a queue, so the shop has to say which shelves and products
-- belong in a game, what they look like there, and, line by line, where a
-- delivery command runs and whether it waits for the player.
--
-- `target` is `server` (run on the command's server) or `player` (run on
-- whichever server the player is on). `whenOnline` defaults to true: a command
-- that hands somebody an item does nothing for a player who is not there, and
-- RCON, which runs the line at once regardless, ignores both columns.
--
-- A gift lands as pending in the recipient's chest. Until they accept it the
-- sender can take it back, and a member can say they take no gifts at all.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "showInGame" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "gameTitle" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "gameDescription" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "gameIcon" TEXT;

ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "showInGame" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "gameTitle" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "gameDescription" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "gameIcon" TEXT;

ALTER TABLE "ProductCommand" ADD COLUMN IF NOT EXISTS "target" TEXT NOT NULL DEFAULT 'server';
ALTER TABLE "ProductCommand" ADD COLUMN IF NOT EXISTS "whenOnline" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "ChestItem" ADD COLUMN IF NOT EXISTS "giftState" TEXT;
ALTER TABLE "ChestItem" ADD COLUMN IF NOT EXISTS "giftedById" TEXT;
CREATE INDEX IF NOT EXISTS "ChestItem_giftedById_idx" ON "ChestItem"("giftedById");

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "receiveGifts" BOOLEAN NOT NULL DEFAULT true;
