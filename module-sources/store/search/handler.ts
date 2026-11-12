import { log, prisma, searchMatches, searchRank } from "@/core/sdk/server";
import { productsTranslatedAs } from "../lib/store-text";

/** The columns the manifest's search index is built over, in its order. */
const COLUMNS = ["name", "shortDesc", "description"];

interface SearchResult {
    type: string;
    title: string;
    excerpt?: string;
    href: string;
    image?: string;
}

/** What the provider contributes, at most. */
const LIMIT = 5;

type ProductRow = { name: string; slug: string; shortDesc: string | null; image: string | null };

/**
 * Federated search contribution for store products.
 * Called from /api/v1/search?q=... via the ModuleSearchProviders registry.
 *
 * Uses PostgreSQL full-text search via a GIN tsvector index for O(log n)
 * lookups. Falls back to ILIKE-based contains() queries if the FTS index
 * is not yet present.
 *
 * Core asks with the query alone, so no reader's language is known here. A
 * product whose name or description matches only in a translation is still
 * found, after the ones the columns matched, and is listed under its original.
 */
export default async function search(q: string): Promise<SearchResult[]> {
    if (!q || q.length < 2) return [];

    const found = await columnMatches(q);
    if (found.length >= LIMIT) return found;
    const seen = new Set(found.map((r) => r.href));
    const translated = (await translationMatches(q)).filter((r) => !seen.has(r.href));
    return [...found, ...translated].slice(0, LIMIT);
}

/** Products that say `q` in some language other than the original. */
async function translationMatches(q: string): Promise<SearchResult[]> {
    const ids = await productsTranslatedAs(q);
    if (ids.length === 0) return [];
    const rows = await prisma.product.findMany({
        where: { id: { in: ids }, isActive: true },
        select: { name: true, slug: true, shortDesc: true, image: true },
        take: LIMIT,
    });
    return rows.map(toResult);
}

function toResult(r: ProductRow): SearchResult {
    return {
        type: "product",
        title: r.name,
        excerpt: r.shortDesc ?? undefined,
        href: `/store/product/${r.slug}`,
        image: r.image ?? undefined,
    };
}

/** The original columns: full-text where the index exists, a contains match otherwise. */
async function columnMatches(q: string): Promise<SearchResult[]> {
    try {
        // Full-text path
        const rows = await prisma.$queryRaw<ProductRow[]>`
            SELECT name, slug, "shortDesc", image
            FROM "Product"
            WHERE "isActive" = true
              AND ${searchMatches(COLUMNS, q)}
            ORDER BY ${searchRank(COLUMNS, q)} DESC
            LIMIT 5
        `;
        return rows.map(toResult);
    } catch (err) {
        // Fallback to LIKE-based search if FTS index not ready
        log.warn("[store-search] FTS failed, falling back to ILIKE", {
            error: err instanceof Error ? err.message : String(err),
        });
        const rows = await prisma.product.findMany({
            where: {
                AND: [
                    { isActive: true },
                    {
                        OR: [
                            { name: { contains: q, mode: "insensitive" } },
                            { shortDesc: { contains: q, mode: "insensitive" } },
                            { description: { contains: q, mode: "insensitive" } },
                        ],
                    },
                ],
            },
            select: { name: true, slug: true, shortDesc: true, image: true },
            orderBy: { createdAt: "desc" },
            take: 5,
        });
        return rows.map(toResult);
    }
}
