import { log, prisma, searchMatches, searchRank } from "@/core/sdk/server";
import { ARTICLE_TEXT } from "../lib/blog-text";
import { publishedArticle } from "../lib/visible-article";

/** The columns the manifest's search index is built over, in its order. */
const COLUMNS = ["title", "excerpt", "content"];

/** As many results as the search box shows from the blog. */
const LIMIT = 5;

interface Found {
    title: string;
    slug: string;
    excerpt: string | null;
}

interface SearchResult {
    type: string;
    title: string;
    excerpt?: string;
    href: string;
}

/**
 * Federated search contribution for blog articles.
 * Called from /api/v1/search?q=... via the ModuleSearchProviders registry.
 *
 * Uses PostgreSQL full-text search via a GIN tsvector index for O(log n)
 * lookups. Falls back to ILIKE-based contains() queries if the FTS index
 * is not yet present (e.g. fresh install before ensureIndexes() has run).
 *
 * Both paths repeat the visibility rule the public endpoints apply. PUBLISHED
 * on its own is not "visible": `publishedAt` can be stamped in the future by
 * a caller who passes one, and a `publishAt` left over from a schedule
 * survives a status change that does not mention it. The list endpoint and
 * the single-article endpoint both test the dates, so search does as well.
 *
 * An article is also found by what it says in any language the admin
 * translated it into, after the matches on its own columns. Search is asked
 * with no reader's language, so a result is named by its original.
 */
export default async function search(q: string): Promise<SearchResult[]> {
    if (!q || q.length < 2) return [];
    const found = await inColumns(q);
    const more = found.length < LIMIT ? await inTranslations(q, found, LIMIT - found.length) : [];
    return [...found, ...more].map((r) => ({
        type: "blog-article",
        title: r.title,
        excerpt: r.excerpt ?? undefined,
        href: `/blog/${r.slug}`,
    }));
}

/** Visible articles one of whose translations holds `q`, past those already found. */
async function inTranslations(q: string, found: Found[], take: number): Promise<Found[]> {
    const matches = await prisma.contentTranslation.findMany({
        where: {
            owner: ARTICLE_TEXT.owner,
            entity: ARTICLE_TEXT.entity,
            field: { in: COLUMNS },
            text: { contains: q, mode: "insensitive" },
        },
        select: { recordId: true },
        take: 20,
    });
    if (matches.length === 0) return [];
    // At most twenty ids, so the ones already found are dropped here.
    const rows = await prisma.blogArticle.findMany({
        where: { ...publishedArticle(), id: { in: [...new Set(matches.map((m) => m.recordId))] } },
        select: { title: true, slug: true, excerpt: true },
        orderBy: { createdAt: "desc" },
    });
    const seen = new Set(found.map((r) => r.slug));
    return rows.filter((r) => !seen.has(r.slug)).slice(0, take);
}

/** Visible articles whose own columns hold `q`. */
async function inColumns(q: string): Promise<Found[]> {
    try {
        // Full-text path
        const rows = await prisma.$queryRaw<Found[]>`
            SELECT title, slug, excerpt
            FROM "BlogArticle"
            WHERE status = 'PUBLISHED'
              AND "publishedAt" <= NOW()
              AND ("publishAt" IS NULL OR "publishAt" <= NOW())
              AND ${searchMatches(COLUMNS, q)}
            ORDER BY ${searchRank(COLUMNS, q)} DESC
            LIMIT 5
        `;
        return rows;
    } catch (err) {
        // Fallback to LIKE-based search if FTS index not ready
        log.warn("[blog-search] FTS failed, falling back to ILIKE", {
            error: err instanceof Error ? err.message : String(err),
        });
        return prisma.blogArticle.findMany({
            where: {
                AND: [
                    { status: "PUBLISHED" },
                    { publishedAt: { lte: new Date() } },
                    { OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }] },
                    {
                        OR: [
                            { title: { contains: q, mode: "insensitive" } },
                            { excerpt: { contains: q, mode: "insensitive" } },
                            { content: { contains: q, mode: "insensitive" } },
                        ],
                    },
                ],
            },
            select: { title: true, slug: true, excerpt: true },
            orderBy: { createdAt: "desc" },
            take: 5,
        });
    }
}
