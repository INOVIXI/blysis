import { NextRequest, NextResponse } from "next/server";
import { formatCurrency } from "@/core/sdk";
import { dailySeries, dayLabels, hasPermission, prisma, siteCurrency } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { largestFirst, totalsIn, type PaidAmount } from "../../lib/money-totals";

/**
 * Store stats endpoint.
 *
 * Returns:
 *  - stats: scalar KPIs (products / orders / revenue)
 *  - sections: recent orders panel
 *  - charts: daily time series for the Analytics page
 *      * orders-per-day (COMPLETED only, drawn as bars - a count of orders
 *        on a day is a discrete comparison, not a curve through the days)
 *      * revenue-per-day (COMPLETED only, drawn as a filled trend)
 *  - rankings: top products by revenue in the window. A leaderboard has no
 *    time axis, so core gives it its own panel rather than a chart.
 *  - tabs: the report groups the analytics screen files these under. Core
 *    writes no report heading of its own, because "by payment method" and "by
 *    category" are this module's words and core does not know a shop exists.
 *
 * The four grouped reports below are all answered by the database. Revenue by
 * month, by payment method and by category, and who has spent the most, are
 * each one grouped read; doing any of them in JavaScript would mean pulling a
 * year of orders and their items into the process to produce a dozen numbers.
 *
 * Every one of them is also grouped by the currency the order was paid in, and
 * converted into the site's currency before anything is added or ranked. A
 * shop that took lira and now prices in dollars has both on file, and a sum
 * across them is a number in no currency. See `lib/money-totals.ts`. The extra
 * group multiplies the rows by the handful of currencies a shop has taken, so
 * the answer stays small; what it costs is that a `take` can only be applied
 * after the conversion.
 *
 * Accepts ?period=7|30|90|365 to match the analytics date range picker.
 * Defaults to 30 days.
 */
/**
 * The dashboard and analytics screens are the only callers, and both are
 * behind the admin panel. Without this the endpoint answered anyone: an
 * anonymous request read the numbers straight out of the database.
 */
async function requireAdmin(): Promise<NextResponse | null> {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return null;
}

export async function GET(request: NextRequest) {
    const denied = await requireAdmin();
    if (denied) return denied;

    const period = Math.min(
        365,
        Math.max(1, parseInt(request.nextUrl.searchParams.get("period") || "30", 10) || 30),
    );

    const [products, orders, revenueData, base] = await Promise.all([
        prisma.product.count(),
        prisma.order.count(),
        prisma.order.groupBy({ by: ["currency"], _sum: { total: true }, where: { status: "COMPLETED" } }),
        siteCurrency(),
    ]);
    const revenue =
        (await totalsIn(base, revenueData.map((row) => ({ key: "all", currency: row.currency, amount: Number(row._sum.total ?? 0) })))).get("all") ?? 0;

    const recentOrders = await prisma.order.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { username: true } } },
    });

    // ─── Time series for Analytics page ───
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - period);
    startDate.setHours(0, 0, 0, 0);

    // Grouped by the database, counts and revenue in one pass. This used to
    // read every completed order in the window - up to a year of them - to
    // produce one number per day.
    // One series per currency taken in the window, so each day's sums can be
    // converted before they are added. Counts add across currencies as they are.
    const windowCurrencies = await prisma.order.groupBy({
        by: ["currency"],
        where: { status: "COMPLETED", createdAt: { gte: startDate } },
    });
    const series = await Promise.all(
        windowCurrencies.map(async ({ currency }) => ({
            currency,
            rows: await dailySeries({
                table: "Order",
                since: startDate,
                sumColumn: "total",
                equals: { status: "COMPLETED", currency },
            }),
        })),
    );

    const labels = dayLabels(startDate, period);
    const ordersByDay: Record<string, number> = Object.fromEntries(labels.map((k) => [k, 0]));
    const dailyPaid: PaidAmount<string>[] = [];
    for (const { currency, rows } of series) {
        for (const row of rows) {
            if (!(row.day in ordersByDay)) continue;
            ordersByDay[row.day] += row.count;
            dailyPaid.push({ key: row.day, currency, amount: row.sum });
        }
    }
    const revenueByDay = await totalsIn(base, dailyPaid);

    // Top sellers in the window. A line has no currency of its own, it has its
    // order's, and Prisma cannot group across that join. The revenue is the
    // price times the quantity, as in the category report below. The product
    // names are fetched in one follow-up query rather than one per row.
    const productRows = await prisma.$queryRaw<{ id: string; currency: string; revenue: number; units: number }[]>`
        SELECT oi."productId" AS id, o."currency" AS currency,
               COALESCE(SUM(oi."price" * oi."quantity"), 0)::float8 AS revenue,
               COALESCE(SUM(oi."quantity"), 0)::int AS units
        FROM "OrderItem" oi
        JOIN "Order" o ON o."id" = oi."orderId"
        WHERE oi."productId" IS NOT NULL AND o."status" = 'COMPLETED' AND o."createdAt" >= ${startDate}
        GROUP BY 1, 2
    `;
    const productUnits = new Map<string, number>();
    for (const row of productRows) productUnits.set(row.id, (productUnits.get(row.id) ?? 0) + row.units);
    const topRows = largestFirst(
        await totalsIn(base, productRows.map((row) => ({ key: row.id, currency: row.currency, amount: row.revenue }))),
    ).slice(0, 8);
    const topProducts = await prisma.product.findMany({
        where: { id: { in: topRows.map(([id]) => id) } },
        select: { id: true, name: true, slug: true },
    });
    const productById = new Map(topProducts.map((p) => [p.id, p]));

    // ─── The four grouped reports ───
    //
    // A window shorter than a couple of months has nothing to say by month, so
    // the monthly report reaches back a year regardless of the picker. The
    // other three follow the window, because "who spent the most" and "which
    // method" are questions about a period.
    const yearStart = new Date(startDate);
    yearStart.setFullYear(yearStart.getFullYear() - 1);
    yearStart.setDate(1);
    yearStart.setHours(0, 0, 0, 0);

    const [monthlyRows, methodRows, categoryRows, spenderRows] = await Promise.all([
        prisma.$queryRaw<{ month: string; currency: string; orders: number; revenue: number }[]>`
            SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month,
                   "currency" AS currency,
                   COUNT(*)::int AS orders,
                   COALESCE(SUM("total"), 0)::float8 AS revenue
            FROM "Order"
            WHERE "status" = 'COMPLETED' AND "createdAt" >= ${yearStart}
            GROUP BY 1, 2
            ORDER BY 1
        `,
        prisma.order.groupBy({
            by: ["paymentMethod", "currency"],
            _sum: { total: true },
            _count: { _all: true },
            where: { status: "COMPLETED", createdAt: { gte: startDate } },
        }),
        // Prisma cannot group across a join, and the alternative is reading
        // every paid item in the window into the process to add them up.
        prisma.$queryRaw<{ id: string | null; name: string | null; currency: string; revenue: number; units: number }[]>`
            SELECT c."id" AS id, c."name" AS name, o."currency" AS currency,
                   COALESCE(SUM(oi."price" * oi."quantity"), 0)::float8 AS revenue,
                   COALESCE(SUM(oi."quantity"), 0)::int AS units
            FROM "OrderItem" oi
            JOIN "Order" o ON o."id" = oi."orderId"
            LEFT JOIN "Product" p ON p."id" = oi."productId"
            LEFT JOIN "Category" c ON c."id" = p."categoryId"
            WHERE o."status" = 'COMPLETED' AND o."createdAt" >= ${startDate}
            GROUP BY c."id", c."name", o."currency"
        `,
        prisma.order.groupBy({
            by: ["userId", "currency"],
            _sum: { total: true },
            _count: { _all: true },
            where: { status: "COMPLETED", createdAt: { gte: startDate }, userId: { not: null } },
        }),
    ]);

    const months = [...new Set(monthlyRows.map((row) => row.month))].sort();
    const ordersByMonth = new Map<string, number>();
    for (const row of monthlyRows) ordersByMonth.set(row.month, (ordersByMonth.get(row.month) ?? 0) + row.orders);
    const revenueByMonth = await totalsIn(base, monthlyRows.map((row) => ({ key: row.month, currency: row.currency, amount: row.revenue })));

    // A shop that took money before any gateway was named has rows with no
    // method on them, and calling that zero would quietly drop revenue out of
    // the report.
    const methodCounts = new Map<string | null, number>();
    for (const row of methodRows) methodCounts.set(row.paymentMethod, (methodCounts.get(row.paymentMethod) ?? 0) + row._count._all);
    const byMethod = largestFirst(
        await totalsIn(base, methodRows.map((row) => ({ key: row.paymentMethod, currency: row.currency, amount: Number(row._sum.total ?? 0) }))),
    ).slice(0, 8);

    const categories = new Map<string | null, { name: string | null; units: number }>();
    for (const row of categoryRows) {
        const seen = categories.get(row.id);
        categories.set(row.id, { name: row.name, units: (seen?.units ?? 0) + row.units });
    }
    const byCategory = largestFirst(
        await totalsIn(base, categoryRows.map((row) => ({ key: row.id, currency: row.currency, amount: row.revenue }))),
    ).slice(0, 8);

    const spenderCounts = new Map<string, number>();
    for (const row of spenderRows) spenderCounts.set(row.userId as string, (spenderCounts.get(row.userId as string) ?? 0) + row._count._all);
    const spenders = largestFirst(
        await totalsIn(base, spenderRows.map((row) => ({ key: row.userId as string, currency: row.currency, amount: Number(row._sum.total ?? 0) }))),
    ).slice(0, 8);

    const buyers = await prisma.user.findMany({
        where: { id: { in: spenders.map(([userId]) => userId) } },
        select: { id: true, username: true },
    });
    const buyerById = new Map(buyers.map((buyer) => [buyer.id, buyer.username]));

    return NextResponse.json({
        stats: { products, orders, revenue },
        tabs: [
            { id: "store-sales", label: "Sales", labelKey: "analytics_tabSales", order: 1 },
            { id: "store-monthly", label: "By month", labelKey: "analytics_tabMonthly", order: 2 },
            { id: "store-payments", label: "Payment methods", labelKey: "analytics_tabPayments", order: 3 },
            { id: "store-catalogue", label: "Catalogue", labelKey: "analytics_tabCatalogue", order: 4 },
            { id: "store-buyers", label: "Buyers", labelKey: "analytics_tabBuyers", order: 5 },
        ],
        rankings: [
            {
                id: "store-top-products",
                label: "Top products by revenue",
                labelKey: "analytics_storeTopProducts",
                group: "store-catalogue",
                color: "#10b981",
                format: "currency",
                items: topRows.map(([id, value]) => {
                    const product = productById.get(id);
                    return {
                        id,
                        label: product?.name ?? id,
                        value,
                        secondary: `${productUnits.get(id) ?? 0}x`,
                        href: product ? `/admin/store/products/${product.id}/edit` : undefined,
                    };
                }),
            },
            {
                id: "store-by-payment-method",
                label: "Revenue by payment method",
                labelKey: "analytics_storeByPaymentMethod",
                group: "store-payments",
                color: "#8b5cf6",
                format: "currency",
                items: byMethod.map(([method, value]) => ({
                    id: method ?? "unrecorded",
                    label: method ?? "Not recorded",
                    value,
                    secondary: `${methodCounts.get(method) ?? 0}`,
                })),
            },
            {
                id: "store-by-category",
                label: "Revenue by category",
                labelKey: "analytics_storeByCategory",
                group: "store-catalogue",
                color: "#f59e0b",
                format: "currency",
                items: byCategory.map(([id, value]) => ({
                    id: id ?? "uncategorised",
                    label: categories.get(id)?.name ?? "Uncategorised",
                    value,
                    secondary: `${categories.get(id)?.units ?? 0}x`,
                    href: id ? `/admin/store/categories` : undefined,
                })),
            },
            {
                id: "store-top-spenders",
                label: "Top spenders",
                labelKey: "analytics_storeTopSpenders",
                group: "store-buyers",
                color: "#ec4899",
                format: "currency",
                items: spenders.map(([userId, value]) => ({
                    id: userId,
                    // A buyer whose account has since been deleted still spent
                    // the money, so the row stays and says so.
                    label: buyerById.get(userId) ?? "Deleted account",
                    value,
                    secondary: `${spenderCounts.get(userId) ?? 0}`,
                    href: `/admin/users/${userId}`,
                })),
            },
        ],
        charts: [
            {
                id: "store-orders",
                label: "Orders per day",
                labelKey: "analytics_storeOrdersPerDay",
                group: "store-sales",
                labels,
                data: labels.map((k) => ordersByDay[k]),
                color: "#3b82f6",
                type: "bar",
            },
            {
                id: "store-revenue",
                label: "Revenue per day",
                labelKey: "analytics_storeRevenuePerDay",
                group: "store-sales",
                labels,
                data: labels.map((k) => revenueByDay.get(k) ?? 0),
                color: "#10b981",
                format: "currency",
            },
            {
                id: "store-revenue-by-month",
                label: "Revenue by month",
                labelKey: "analytics_storeRevenueByMonth",
                group: "store-monthly",
                labels: months,
                data: months.map((month) => revenueByMonth.get(month) ?? 0),
                color: "#10b981",
                type: "bar",
                format: "currency",
            },
            {
                id: "store-orders-by-month",
                label: "Orders by month",
                labelKey: "analytics_storeOrdersByMonth",
                group: "store-monthly",
                labels: months,
                data: months.map((month) => ordersByMonth.get(month) ?? 0),
                color: "#3b82f6",
                type: "bar",
            },
        ],
        sections: [
            {
                id: "recent-orders",
                title: "Recent Orders",
                titleKey: "dashboard_recentOrders",
                viewAllHref: "/admin/store/orders",
                items: recentOrders.map((o) => ({
                    id: o.id,
                    href: "/admin/store/orders/" + o.id,
                    primary: o.orderNumber,
                    secondary: (o.user?.username ?? "Deleted user") + " · " + o.createdAt.toISOString().split("T")[0],
                    badge: o.status,
                    badgeColor: o.status === "COMPLETED" ? "green" : o.status === "PENDING" ? "yellow" : "blue",
                    // Each order in the currency it was paid in, not a dollar sign
                    // on whatever number it holds.
                    value: formatCurrency(Number(o.total), o.currency),
                })),
            },
        ],
    });
}
