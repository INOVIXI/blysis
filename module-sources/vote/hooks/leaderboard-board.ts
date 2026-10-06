/**
 * Answers `leaderboard.boards` with what this module can rank: who has voted
 * most often.
 */
import { prisma } from "@/core/sdk/server";

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
    id: "voters",
    labelKey: "vote.leaderboardVoters",
    icon: "Medal",
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

const topVoters = async (current: Board[], context: BoardsQuestion): Promise<Board[]> => {
    if (context.boardId && context.boardId !== BOARD.id) return current;
    if (!context.boardId) return [...current, { ...BOARD, rows: [] }];

    const votes = await prisma.voteLog.groupBy({
        by: ["userId"],
        _count: true,
        orderBy: { _count: { userId: "desc" } },
        where: context.since ? { createdAt: { gte: context.since } } : undefined,
        take: context.limit,
    });

    const userIds = votes.map((row) => row.userId).filter((id): id is string => id !== null);
    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, avatar: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const rows = votes
        .filter((row): row is typeof row & { userId: string } => row.userId !== null)
        .map((row) => ({
            username: byId.get(row.userId)?.username ?? "",
            avatar: byId.get(row.userId)?.avatar ?? null,
            value: row._count,
        }))
        .filter((row) => row.username !== "");

    return [...current, { ...BOARD, rows: ranked(rows, context.search) }];
};

export default topVoters;
