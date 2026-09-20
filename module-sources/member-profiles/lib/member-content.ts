/**
 * What a member has written, and where each of it lives.
 *
 * The profile's five counters were totals with nothing behind them. Making
 * them lead somewhere needs two things this module cannot ask another module
 * for: which column holds the author, and how to build the address of the
 * thing. Both are written here, next to the counting they belong with, and a
 * kind whose model is absent is simply not offered - the same rule the counts
 * already follow.
 *
 * `a-module-that-reads-another-modules-table-says-so` is the gate that keeps
 * this honest: this module declares what it reads.
 *
 * Isomorphic on purpose. The list page reads `CONTENT_KINDS` to know which
 * counters are listable, and it runs in a browser.
 */

export interface ContentItem {
    id: string;
    /** What the thing is called. A reply is titled by what it replies to. */
    title: string;
    /** The first words of it, where the kind has a body. */
    excerpt: string | null;
    /** Where it is. Null when the row has lost what it hung off. */
    href: string | null;
    createdAt: string;
}

interface ContentKind {
    /** Matches the statistic key the profile counts. */
    kind: string;
    model: string;
    field: string;
    /** Narrows to what a stranger may read. */
    where?: Record<string, unknown>;
    select: Record<string, unknown>;
    item(row: Record<string, unknown>): ContentItem;
}

/** The first words of a body, for a list that shows one line of each. */
function excerptOf(value: unknown, length = 180): string | null {
    if (typeof value !== "string") return null;
    const text = value.replace(/\s+/g, " ").trim();
    if (text === "") return null;
    return text.length > length ? `${text.slice(0, length)}...` : text;
}

function when(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value ?? "");
}

/**
 * Only what a stranger may read. Everything here filters on the moderation
 * state the module writes, because a comment held for review is not published
 * and listing it on its author's profile publishes it.
 */
const APPROVED = { moderationState: "APPROVED" };

export const CONTENT_KINDS: ReadonlyArray<ContentKind> = [
    {
        kind: "topics",
        model: "forumTopic",
        field: "authorId",
        where: APPROVED,
        select: { id: true, title: true, slug: true, content: true, createdAt: true },
        item: (row) => ({
            id: String(row.id),
            title: String(row.title ?? ""),
            excerpt: excerptOf(row.content),
            href: `/forum/topic/${row.id}/${row.slug}`,
            createdAt: when(row.createdAt),
        }),
    },
    {
        kind: "posts",
        model: "forumPost",
        field: "authorId",
        where: APPROVED,
        select: {
            id: true,
            content: true,
            createdAt: true,
            topic: { select: { id: true, title: true, slug: true } },
        },
        item: (row) => {
            const topic = row.topic as { id: string; title: string; slug: string } | null;
            return {
                id: String(row.id),
                title: topic?.title ?? "",
                excerpt: excerptOf(row.content),
                // The anchor is what makes a reply worth linking to: the
                // thread alone drops the reader at the top of a page they have
                // to read to find the thing they clicked.
                href: topic ? `/forum/topic/${topic.id}/${topic.slug}#post-${row.id}` : null,
                createdAt: when(row.createdAt),
            };
        },
    },
    {
        kind: "comments",
        model: "blogComment",
        field: "authorId",
        where: APPROVED,
        select: {
            id: true,
            content: true,
            createdAt: true,
            article: { select: { number: true, title: true, slug: true } },
        },
        item: (row) => {
            const article = row.article as { number: number; title: string; slug: string } | null;
            return {
                id: String(row.id),
                title: article?.title ?? "",
                excerpt: excerptOf(row.content),
                href: article ? `/blog/${article.number}/${article.slug}` : null,
                createdAt: when(row.createdAt),
            };
        },
    },
    {
        kind: "suggestions",
        model: "suggestion",
        field: "authorId",
        where: { ...APPROVED, visibility: "public" },
        select: { id: true, title: true, content: true, createdAt: true },
        item: (row) => ({
            id: String(row.id),
            title: String(row.title ?? ""),
            excerpt: excerptOf(row.content),
            href: `/suggestions/${row.id}`,
            createdAt: when(row.createdAt),
        }),
    },
];

/** Whether a counted statistic can be opened. Orders are counted and are not. */
export function isListable(kind: string): boolean {
    return CONTENT_KINDS.some((k) => k.kind === kind);
}
