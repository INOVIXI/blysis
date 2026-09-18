/**
 * Answers `leaderboard.boards` with what this module can rank: who has voted
 * most often.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";

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

const topVoters: HookHandlerFor<"leaderboard.boards", "filter"> = async (current, context) => {
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
