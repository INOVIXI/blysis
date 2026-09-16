// Loading + normalising the marketplace index, shared by the two routes that
// serve it: the admin-facing /api/v1/modules/marketplace and the first-run
// /api/setup/modules. Kept in a non-route file so Next.js only sees valid HTTP
// exports from each route.ts.

import fs from "fs/promises";
import path from "path";
import type { MarketplaceIndex, MarketplaceModule } from "./_types";
import {
    MARKETPLACE_CACHE_TTL_MS,
    getCachedMarketplace,
    setCachedMarketplace,
} from "./_cache";
import { marketplaceIsConfigured, moduleMarketplaceIndexUrl } from "@/core/lib/marketplace-source";

const LOCAL_INDEX_PATH = path.join(process.cwd(), "module-marketplace", "index.json");

async function fromDisk(): Promise<MarketplaceIndex> {
    const raw = await fs.readFile(LOCAL_INDEX_PATH, "utf-8");
    return JSON.parse(raw) as MarketplaceIndex;
}

async function fromMarketplace(): Promise<MarketplaceIndex> {
    const res = await fetch(moduleMarketplaceIndexUrl(), { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as MarketplaceIndex;
}

/**
 * Where the list of installable modules comes from.
 *
 * Which of the two leads depends on whether the operator configured a
 * marketplace. This file shipped with the disk copy always first, which is
 * right for a checkout serving its own catalogue and wrong for an install
 * pointed elsewhere: the ZIPs came from the configured marketplace and the
 * list of what could be installed came from the copy in the image, so
 * everything the operator was paying for was invisible while installing
 * appeared to work.
 *
 * The loser is still the fallback in both directions, so an install with no
 * network reads its own catalogue and a stripped checkout reads the
 * product's.
 */
async function loadBaseIndex(): Promise<MarketplaceIndex> {
    const [first, second] = marketplaceIsConfigured() ? [fromMarketplace, fromDisk] : [fromDisk, fromMarketplace];
    try {
        return await first();
    } catch {
        return await second();
    }
}

function ensureDefaults(
    m: Partial<MarketplaceModule> & { id: string; name: string; version: string },
): MarketplaceModule {
    return {
        id: m.id,
        name: m.name,
        description: m.description ?? "",
        version: m.version,
        // Empty, not this product's name. A catalogue served from a fork or
        // an internal mirror credited every unattributed module to whoever
        // wrote the platform, which is a claim about somebody else's work.
        author: m.author ?? "",
        icon: m.icon ?? "Package",
        category: m.category ?? "content",
        verified: m.verified ?? true,
        updatedAt: m.updatedAt ?? new Date().toISOString(),
        screenshots: m.screenshots ?? [],
        tags: m.tags ?? [m.category ?? "uncategorized"],
        zip: m.zip ?? `${m.id}.zip`,
        dependencies: m.dependencies ?? [],
        conflicts: m.conflicts ?? [],
        coreVersion: m.coreVersion ?? null,
        stats: m.stats ?? { publicRoutes: 0, adminRoutes: 0, apiRoutes: 0, widgets: 0 },
    };
}

/**
 * The normalised catalog, memoised for MARKETPLACE_CACHE_TTL_MS.
 *
 * Returns the last good copy when a refresh fails, and throws only when there
 * is nothing cached to fall back to. Callers decide what an empty catalog
 * means for their surface.
 */
export async function loadMarketplaceCatalog(): Promise<MarketplaceIndex> {
    const cache = getCachedMarketplace();
    if (cache.index && Date.now() - cache.time < MARKETPLACE_CACHE_TTL_MS) {
        return cache.index;
    }

    try {
        const base = await loadBaseIndex();
        const normalized: MarketplaceIndex = {
            ...base,
            modules: base.modules.map((m) => ensureDefaults(m)),
        };
        setCachedMarketplace(normalized);
        return normalized;
    } catch (err) {
        if (cache.index) return cache.index;
        throw err;
    }
}
