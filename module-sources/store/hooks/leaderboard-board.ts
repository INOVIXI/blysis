/**
 * Answers `leaderboard.boards` with what the shop can rank: who has spent the
 * most.
 *
 * The leaderboard used to query `Order` itself, which meant that module knew
 * the shop's table, its status vocabulary and that `total` is money. It asks
 * now, and this file is the only place any of that is known.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";

const BOARD = {
    id: "buyers",
    labelKey: "store.leaderboardBuyers",
    icon: "Crown",
    unit: "currency" as const,
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

const topBuyers: HookHandlerFor<"leaderboard.boards", "filter"> = async (current, context) => {
    if (context.boardId && context.boardId !== BOARD.id) return current;
    if (!context.boardId) return [...current, { ...BOARD, rows: [] }];

    const spend = await prisma.order.groupBy({
        by: ["userId"],
        where: {
            status: "COMPLETED",
            ...(context.since ? { createdAt: { gte: context.since } } : {}),
        },
        _sum: { total: true },
        orderBy: { _sum: { total: "desc" } },
        take: context.limit,
    });

    // `Order.userId` is nullable: a deleted account leaves its orders behind
    // with nobody to credit, and those are not a row on a leaderboard.
    const userIds = spend.map((row) => row.userId).filter((id): id is string => id !== null);
    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, avatar: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const rows = spend
        .filter((row): row is typeof row & { userId: string } => row.userId !== null)
        .map((row) => ({
            username: byId.get(row.userId)?.username ?? "",
            avatar: byId.get(row.userId)?.avatar ?? null,
            value: Number(row._sum.total ?? 0),
        }))
        .filter((row) => row.username !== "");

    return [...current, { ...BOARD, rows: ranked(rows, context.search) }];
};

export default topBuyers;
