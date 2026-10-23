/**
 * Answers `leaderboard.boards` with what the forum can rank: who has posted
 * the most.
 */
import { prisma } from "@/core/sdk/server";
import { visibleCategoryIds } from "../lib/visible-categories";

/**
 * A board and the question asked for it, as this module reads them.
 *
 * Stated here rather than taken from `HookHandlerFor<"leaderboard.boards">`:
 * that shape is declared by the leaderboard module, and a site that installs
 * this one without it still builds this file. Without the declaration the
 * hook's types fall back to `unknown` and every read of `context` was a
 * compile error, which failed the whole site's build. With both installed,
 * `npm run typecheck:modules` holds these against the declared contract.
 */
interface Board {
    id: string;
    labelKey: string;
    icon: string;
    unit: "currency" | "count";
    rows: { username: string; avatar: string | null; value: number; rank: number }[];
}

interface BoardsQuestion {
    boardId: string | null;
    limit: number;
    search?: string;
    since?: Date | null;
}

const BOARD = {
    id: "posters",
    labelKey: "forum.leaderboardPosters",
    icon: "MessageSquare",
    unit: "count" as const,
};

/**
 * Number the ordering, then narrow it.
 *
 * Both halves matter and the order does. The rank is what the ranking said,
 * so it is assigned before a search can remove anybody; the search is a
 * plain, case-insensitive contains, because a leaderboard is read to find
 * one person and nobody types an exact username.
 */
function ranked<T extends { username: string }>(rows: T[], search: string | undefined): (T & { rank: number })[] {
    const numbered = rows.map((row, at) => ({ ...row, rank: at + 1 }));
    const term = search?.trim().toLowerCase() ?? "";
    return term === "" ? numbered : numbered.filter((row) => row.username.toLowerCase().includes(term));
}

const topPosters = async (current: Board[], context: BoardsQuestion): Promise<Board[]> => {
    if (context.boardId && context.boardId !== BOARD.id) return current;
    if (!context.boardId) return [...current, { ...BOARD, rows: [] }];

    // A topic's opening post is the topic's own `content`, not a reply row, so
    // counting replies alone left a member who started thirty discussions off
    // the board. Both halves count only what a visitor could read: the board
    // is public, so neither the moderation queue nor a category shut to
    // visitors may move anybody up it.
    // `the-most-active-are-counted-by-what-a-visitor-can-read` holds all three.
    const readable = await visibleCategoryIds(null);
    const inReadableCategory = readable.everything ? {} : { categoryId: { in: readable.categoryIds } };
    const since = context.since ? { createdAt: { gte: context.since } } : {};
    const [topics, replies] = await Promise.all([
        prisma.forumTopic.groupBy({
            by: ["authorId"],
            _count: true,
            where: { moderationState: "APPROVED", ...inReadableCategory, ...since },
        }),
        prisma.forumPost.groupBy({
            by: ["authorId"],
            _count: true,
            where: { moderationState: "APPROVED", topic: { moderationState: "APPROVED", ...inReadableCategory }, ...since },
        }),
    ]);

    // Untaken, because the ranking is the sum: a member tenth on topics and
    // tenth on replies can be first on the board, and the two lists cut at
    // the limit would never have said so. A group is one row per author.
    const totals = new Map<string, number>();
    for (const row of [...topics, ...replies]) {
        // `authorId` is nullable: a post whose author is gone has nobody to rank.
        if (row.authorId === null) continue;
        totals.set(row.authorId, (totals.get(row.authorId) ?? 0) + row._count);
    }
    const posts = [...totals]
        .map(([authorId, count]) => ({ authorId, _count: count }))
        .sort((a, b) => b._count - a._count)
        .slice(0, context.limit);

    const authorIds = posts.map((row) => row.authorId);
    const users = await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, username: true, avatar: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const rows = posts
        .map((row) => ({
            username: byId.get(row.authorId)?.username ?? "",
            avatar: byId.get(row.authorId)?.avatar ?? null,
            value: row._count,
        }))
        .filter((row) => row.username !== "");

    return [...current, { ...BOARD, rows: ranked(rows, context.search) }];
};

export default topPosters;
