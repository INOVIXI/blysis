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

/** A row, plus whether the reader asking for it has already voted. */
export type SuggestionListRow = Awaited<ReturnType<typeof rows>>[number] & { voted: boolean };

export interface SuggestionListRead {
    suggestions: SuggestionListRow[];
    total: number;
    pages: number;
    page: number;
}

/**
 * `readerId` narrows the votes joined to each row to that reader's own, so a
 * row arrives knowing whether the person reading it has voted. It used to
 * arrive knowing only the total, and the board started every button off: the
 * only thing that ever turned one on was the response to pressing it, so
 * coming back to the page offered to cast a vote that was already cast, and
 * pressing it took that vote away.
 *
 * One vote per member per suggestion is a unique constraint, so the join is
 * at most one row and costs a lookup on the index that enforces it.
 */
function rows(
    where: Record<string, unknown>,
    orderBy: { upvotes: "desc" } | { createdAt: "desc" },
    skip: number,
    take: number,
    readerId: string | null,
) {
    return prisma.suggestion.findMany({
        where,
        include: {
            author: { select: { id: true, username: true, avatar: true } },
            _count: { select: { votes: true } },
            votes: readerId
                ? { where: { userId: readerId }, select: { id: true }, take: 1 }
                : { where: { id: "" }, select: { id: true }, take: 0 },
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

    const readerId = session?.user?.id ?? null;
    const [found, total] = await Promise.all([
        rows(where, orderBy, (page - 1) * perPage, perPage, readerId),
        prisma.suggestion.count({ where }),
    ]);

    // The reader's own vote leaves as a yes or a no. Handing the rows back
    // with somebody's vote id on them would put one person's record on
    // another's screen the moment anything caches a response.
    const suggestions = found.map(({ votes, ...row }) => ({ ...row, voted: votes.length > 0 }));

    return { suggestions, total, pages: Math.max(1, Math.ceil(total / perPage)), page };
}
