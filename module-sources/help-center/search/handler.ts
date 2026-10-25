import { log, moduleSettings, prisma, searchMatches, searchRank } from "@/core/sdk/server";

/** The columns the manifest's search index is built over, in its order. */
const COLUMNS = ["title", "content"];

interface SearchResult {
    type: string;
    title: string;
    excerpt?: string;
    href: string;
}

/**
 * Federated search contribution for help-center articles.
 * Called from /api/v1/search?q=... via the ModuleSearchProviders registry.
 *
 * Uses PostgreSQL full-text search via a GIN tsvector index for O(log n)
 * lookups. Falls back to ILIKE-based contains() queries if the FTS index
 * is not yet present.
 *
 * Both paths repeat the visibility rule the public endpoints apply. Clearing
 * `isActive` is how an article is taken down - the list, the single-article
 * endpoint and the category listing all honour it - so search has to honour
 * it too, or taking an article down leaves it readable to anyone who
 * searches for a phrase in it.
 */
export default async function search(q: string): Promise<SearchResult[]> {
    if (!q || q.length < 2) return [];

    // A site that keeps its help centre out of search says so here. The
    // provider stays registered - contributions are wired in at build time -
    // and simply contributes nothing.
    const { enableSearch } = await moduleSettings<{ enableSearch: boolean }>("help-center");
    if (!enableSearch) return [];

    try {
        // Full-text path
        const rows = await prisma.$queryRaw<Array<{ title: string; slug: string; content: string }>>`
            SELECT title, slug, content
            FROM "HelpArticle"
            WHERE "isActive" = true
              AND ${searchMatches(COLUMNS, q)}
            ORDER BY ${searchRank(COLUMNS, q)} DESC
            LIMIT 5
        `;
        return rows.map((r) => ({
            type: "help-article",
            title: r.title,
            excerpt: r.content.slice(0, 140),
            href: `/help/${r.slug}`,
        }));
    } catch (err) {
        // Fallback to LIKE-based search if FTS index not ready
        log.warn("[help-search] FTS failed, falling back to ILIKE", {
            error: err instanceof Error ? err.message : String(err),
        });
        const rows = await prisma.helpArticle.findMany({
            where: {
                AND: [
                    { isActive: true },
                    {
                        OR: [
                            { title: { contains: q, mode: "insensitive" } },
                            { content: { contains: q, mode: "insensitive" } },
                        ],
                    },
                ],
            },
            select: { title: true, slug: true, content: true },
            orderBy: { createdAt: "desc" },
            take: 5,
        });
        return rows.map((r) => ({
            type: "help-article",
            title: r.title,
            excerpt: r.content.slice(0, 140),
            href: `/help/${r.slug}`,
        }));
    }
}
