import { NextResponse } from "next/server";
import { isModuleEnabled, prisma, siteCurrency } from "@/core/sdk/server";
import { largestFirst, totalsIn } from "../../lib/money-totals";

// GET /api/v1/store/widget-stats - Public stats for homepage widgets
export async function GET() {
    try {
        // Check if store module is enabled
        if (!(await isModuleEnabled("store"))) {
            return NextResponse.json({
                recentPurchases: [],
                topCustomer: null,
                topBuyers: [],
                topCreditLoaders: [],
            });
        }

        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const rawOrders = await prisma.order.findMany({
            where: { status: "COMPLETED" },
            select: {
                userId: true,
                createdAt: true,
                user: { select: { username: true, avatar: true } },
                items: { select: { product: { select: { name: true, image: true } } } },
            },
            orderBy: { createdAt: "desc" },
            // Four are shown. The margin covers orders whose buyer has since
            // been deleted, which are dropped below.
            take: 20,
        });

        // Drop orders whose user was deleted (SetNull cascade). Widgets
        // surface usernames/avatars, so anonymous rows have nothing to show.
        const recentOrders = rawOrders.filter(
            (o): o is typeof o & { userId: string; user: NonNullable<typeof o.user> } =>
                o.userId !== null && o.user !== null,
        );

        const recentPurchases = recentOrders.slice(0, 4).map((o) => ({
            username: o.user.username,
            avatar: o.user.avatar,
            product: o.items[0]?.product?.name || "Unknown",
            productImage: o.items[0]?.product?.image || null,
            time: o.createdAt,
        }));

        // Each widget names its window, and the number has to be from it: the
        // top customer was the biggest spender among the last hundred orders
        // ever placed, so a site whose newest orders were a year old showed
        // that year under "this month". The month starts on the server's
        // calendar, as the community goal's does.
        const base = await siteCurrency();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const [monthly, weekly, loaders] = await Promise.all([
            prisma.order.groupBy({
                by: ["userId", "currency"],
                where: { status: "COMPLETED", userId: { not: null }, createdAt: { gte: monthStart } },
                _sum: { total: true },
            }),
            prisma.order.groupBy({
                by: ["userId", "currency"],
                where: { status: "COMPLETED", userId: { not: null }, createdAt: { gte: weekAgo } },
                _sum: { total: true },
            }),
            // What members paid for credits, which is what the widget is
            // called: it used to rank the same order spend as the others.
            prisma.creditTopUp.groupBy({
                by: ["userId", "currency"],
                where: { status: "COMPLETED", userId: { not: null } },
                _sum: { amount: true },
            }),
        ]);

        // Grouped per member and currency, never summed across currencies in
        // the database: a member's lira and dollars are converted first and
        // added after. See `lib/money-totals.ts`. The groups number members
        // times currencies, not orders, so no `take` is needed or correct: a
        // cut before the conversion ranks the wrong people.
        const [monthTotals, weekTotals, loaderTotals] = await Promise.all([
            totalsIn(base, monthly.map((g) => ({ key: g.userId as string, currency: g.currency, amount: Number(g._sum.total ?? 0) }))),
            totalsIn(base, weekly.map((g) => ({ key: g.userId as string, currency: g.currency, amount: Number(g._sum.total ?? 0) }))),
            totalsIn(base, loaders.map((g) => ({ key: g.userId as string, currency: g.currency, amount: Number(g._sum.amount ?? 0) }))),
        ]);
        const ranked = [
            largestFirst(monthTotals).slice(0, 1),
            largestFirst(weekTotals).slice(0, 5),
            largestFirst(loaderTotals).slice(0, 5),
        ];

        const ids = [...new Set(ranked.flat().map(([userId]) => userId))];
        const users = await prisma.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, username: true, avatar: true },
            take: ids.length,
        });
        const byId = new Map(users.map((u) => [u.id, u]));
        const named = (rows: [string, number][]) =>
            rows.flatMap(([userId, total]) => {
                const user = byId.get(userId);
                return user ? [{ username: user.username, avatar: user.avatar, total }] : [];
            });

        const topCustomer = named(ranked[0])[0] ?? null;
        const topBuyers = named(ranked[1]);
        const topCreditLoaders = named(ranked[2]);

        return NextResponse.json({
            recentPurchases,
            topCustomer,
            topBuyers,
            topCreditLoaders,
        }, {
            headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" },
        });
    } catch {
        return NextResponse.json({
            recentPurchases: [],
            topCustomer: null,
            topBuyers: [],
            topCreditLoaders: [],
        });
    }
}
