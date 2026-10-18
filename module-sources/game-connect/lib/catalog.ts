/**
 * The in-game catalogue, as the store answers it, and the version a client
 * compares against its cache.
 *
 * This module does not know what a product is. The store does, and answers
 * `store.catalog.ingame`; a site without the store answers with an empty
 * catalogue, which a client shows as an empty menu rather than an error.
 */
import crypto from "crypto";
import { readCatalog, type Catalog } from "./bridge";

export { readCatalog };

/** A short digest of what a client would draw. Equal content, equal version. */
export function versionOf(catalog: Catalog): string {
    const digest = crypto.createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
    return `c-${digest.slice(0, 16)}`;
}

export async function catalogVersion(): Promise<string> {
    return versionOf(await readCatalog());
}
