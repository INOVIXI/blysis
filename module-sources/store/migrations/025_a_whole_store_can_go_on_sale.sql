-- A percentage off the whole store, or off chosen shelves, for a set time.
--
-- A new table and nothing else: a shop with no row in it prices every product
-- exactly as it did before, so nothing is cheaper on deploy.
CREATE TABLE IF NOT EXISTS "StoreSale" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoreSale_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StoreSale_isActive_startsAt_endsAt_idx" ON "StoreSale"("isActive", "startsAt", "endsAt");
