/**
 * Answers `credits.top`: the members who hold the most, or who bought the most.
 *
 * A top-up is a `credit_purchase` row, the one the wallet writes when money
 * buys credits. Gifts, refunds and prizes are not somebody spending, so they do
 * not count. The period starts on the server's calendar.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";

const MAX = 100;

function since(period: "day" | "month" | "year" | "all", now: Date): Date | null {
    if (period === "day") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
    if (period === "year") return new Date(now.getFullYear(), 0, 1);
    return null;
}

const top: HookHandlerFor<"credits.top", "filter"> = async (_current, { kind, period, limit }) => {
    const take = Math.max(1, Math.min(MAX, Math.trunc(limit)));
    if (kind === "balance") {
        const rows = await prisma.user.findMany({
            where: { creditBalance: { gt: 0 } },
            orderBy: { creditBalance: "desc" },
            select: { id: true, username: true, creditBalance: true },
            take,
        });
        return rows.map((row, i) => ({ rank: i + 1, userId: row.id, name: row.username, amount: Number(row.creditBalance) }));
    }

    const from = since(period, new Date());
    const grouped = await prisma.creditTransaction.groupBy({
        by: ["userId"],
        where: { type: "credit_purchase", userId: { not: null }, ...(from ? { createdAt: { gte: from } } : {}) },
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
        take,
    });
    const ids = grouped.map((g) => g.userId).filter((id): id is string => Boolean(id));
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true }, take: ids.length });
    const names = new Map(users.map((u) => [u.id, u.username]));
    return grouped
        .filter((g) => g.userId && names.has(g.userId))
        .map((g, i) => ({ rank: i + 1, userId: g.userId as string, name: names.get(g.userId as string) as string, amount: Number(g._sum.amount ?? 0) }));
};

export default top;
