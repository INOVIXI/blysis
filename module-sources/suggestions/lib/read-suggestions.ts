/**
 * The suggestions a reader may see, read on the server.
 *
 * The board fetched them after the page had loaded, so the HTML the server
 * sent carried no suggestion, no title and no link to one: measured, 165
 * characters of text inside `<main>`.
 *
 * The endpoint calls this too, so the rule about what a reader may see is
 * written once: everyone sees the public, approved ones, and an administrator
 * sees the rest. A private suggestion listed by one caller and hidden by the
 * other is worse than one nobody hid.
 */
import { isAdmin, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { canonicalStatus, spellingsOf } from "./statuses";

export interface SuggestionListRead {
    suggestions: Awaited<ReturnType<typeof rows>>;
    total: number;
    pages: number;
    page: number;
}

function rows(
    where: Record<string, unknown>,
    orderBy: { upvotes: "desc" } | { createdAt: "desc" },
    skip: number,
    take: number,
) {
    return prisma.suggestion.findMany({
        where,
        include: {
            author: { select: { id: true, username: true, avatar: true } },
            _count: { select: { votes: true } },
        },
        orderBy,
        skip,
        take,
    });
}

export async function readSuggestions(options: {
    status?: string | null;
    sort?: string;
    page?: number;
    perPage?: number;
}): Promise<SuggestionListRead> {
    const session = await auth();
    const readerIsAdmin = session?.user?.id ? await isAdmin(session.user.id) : false;
    const perPage = Math.max(1, options.perPage ?? 20);
    const page = Math.max(1, Math.floor(options.page ?? 1) || 1);

    const where: Record<string, unknown> = {};
    // A status filter is a filter on the state, not on the spelling the row
    // happened to be written with.
    if (options.status) {
        const canonical = canonicalStatus(options.status);
        where.status = canonical ? { in: spellingsOf(canonical) } : options.status;
    }
    if (!readerIsAdmin) {
        where.visibility = "public";
        where.moderationState = "APPROVED";
    }

    const orderBy = options.sort === "popular"
        ? { upvotes: "desc" as const }
        : { createdAt: "desc" as const };

    const [suggestions, total] = await Promise.all([
        rows(where, orderBy, (page - 1) * perPage, perPage),
        prisma.suggestion.count({ where }),
    ]);

    return { suggestions, total, pages: Math.max(1, Math.ceil(total / perPage)), page };
}
