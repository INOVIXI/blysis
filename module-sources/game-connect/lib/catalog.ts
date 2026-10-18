/**
 * The in-game catalogue, as the store answers it, and the version a client
 * compares against its cache.
 *
 * This module does not know what a product is. The store does, and answers
 * `store.catalog.ingame`; a site without the store answers with an empty
 * catalogue, which a client shows as an empty menu rather than an error.
 */
import crypto from "crypto";
import { applyFiltersAsync } from "@/core/sdk";

export const EMPTY_CATALOG: InGameCatalog = { currency: "credits", categories: [] };

export async function readCatalog(): Promise<InGameCatalog> {
    const catalog = await applyFiltersAsync("store.catalog.ingame", EMPTY_CATALOG, {});
    return catalog ?? EMPTY_CATALOG;
}

/** A short digest of what a client would draw. Equal content, equal version. */
export function versionOf(catalog: InGameCatalog): string {
    const digest = crypto.createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
    return `c-${digest.slice(0, 16)}`;
}

export async function catalogVersion(): Promise<string> {
    return versionOf(await readCatalog());
}
