/**
 * Answers `leaderboard.boards` with what the shop can rank: who has spent the
 * most.
 *
 * The leaderboard used to query `Order` itself, which meant that module knew
 * the shop's table, its status vocabulary and that `total` is money. It asks
 * now, and this file is the only place any of that is known.
 */
import { prisma, siteCurrency } from "@/core/sdk/server";
import { largestFirst, totalsIn } from "../lib/money-totals";

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

const topBuyers = async (current: Board[], context: BoardsQuestion): Promise<Board[]> => {
    if (context.boardId && context.boardId !== BOARD.id) return current;
    if (!context.boardId) return [...current, { ...BOARD, rows: [] }];

    // Grouped per member and currency, converted, and only then ranked and
    // cut: a `take` on the database's sum ranks lira against dollars as if
    // they were one money. See `lib/money-totals.ts`. A deleted account
    // leaves its orders behind with nobody to credit (`Order.userId` is
    // nullable), and those are not a row on a leaderboard.
    const spend = await prisma.order.groupBy({
        by: ["userId", "currency"],
        where: {
            status: "COMPLETED",
            userId: { not: null },
            ...(context.since ? { createdAt: { gte: context.since } } : {}),
        },
        _sum: { total: true },
    });
    const totals = await totalsIn(
        await siteCurrency(),
        spend.map((row) => ({ key: row.userId as string, currency: row.currency, amount: Number(row._sum.total ?? 0) })),
    );
    const top = largestFirst(totals).slice(0, context.limit);

    const users = await prisma.user.findMany({
        where: { id: { in: top.map(([userId]) => userId) } },
        select: { id: true, username: true, avatar: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const rows = top
        .map(([userId, value]) => ({
            username: byId.get(userId)?.username ?? "",
            avatar: byId.get(userId)?.avatar ?? null,
            value,
        }))
        .filter((row) => row.username !== "");

    return [...current, { ...BOARD, rows: ranked(rows, context.search) }];
};

export default topBuyers;
