import { NextRequest, NextResponse } from "next/server";
import { formatCurrency } from "@/core/sdk";
import { dailySeries, dayLabels, hasPermission, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

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

    const [products, orders, revenueData] = await Promise.all([
        prisma.product.count(),
        prisma.order.count(),
        prisma.order.aggregate({ _sum: { total: true }, where: { status: "COMPLETED" } }),
    ]);
    const revenue = Number(revenueData._sum.total || 0);

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
    const series = await dailySeries({
        table: "Order",
        since: startDate,
        sumColumn: "total",
        equals: { status: "COMPLETED" },
    });

    const labels = dayLabels(startDate, period);
    const ordersByDay: Record<string, number> = Object.fromEntries(labels.map((k) => [k, 0]));
    const revenueByDay: Record<string, number> = Object.fromEntries(labels.map((k) => [k, 0]));
    for (const row of series) {
        if (!(row.day in ordersByDay)) continue;
        ordersByDay[row.day] = row.count;
        revenueByDay[row.day] = row.sum;
    }

    // Top sellers in the window. Grouped in the database; the product names
    // are fetched in one follow-up query rather than one per row.
    const topRows = await prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { price: true, quantity: true },
        where: {
            productId: { not: null },
            order: { status: "COMPLETED", createdAt: { gte: startDate } },
        },
        orderBy: { _sum: { price: "desc" } },
        take: 8,
    });
    const topProducts = await prisma.product.findMany({
        where: { id: { in: topRows.map((r) => r.productId!).filter(Boolean) } },
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

    const [monthly, byMethod, byCategory, spenders] = await Promise.all([
        prisma.$queryRaw<{ month: string; orders: number; revenue: number }[]>`
            SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month,
                   COUNT(*)::int AS orders,
                   COALESCE(SUM("total"), 0)::float8 AS revenue
            FROM "Order"
            WHERE "status" = 'COMPLETED' AND "createdAt" >= ${yearStart}
            GROUP BY 1
            ORDER BY 1
        `,
        prisma.order.groupBy({
            by: ["paymentMethod"],
            _sum: { total: true },
            _count: { _all: true },
            where: { status: "COMPLETED", createdAt: { gte: startDate } },
            orderBy: { _sum: { total: "desc" } },
            take: 8,
        }),
        // Prisma cannot group across a join, and the alternative is reading
        // every paid item in the window into the process to add them up.
        prisma.$queryRaw<{ id: string | null; name: string | null; revenue: number; units: number }[]>`
            SELECT c."id" AS id, c."name" AS name,
                   COALESCE(SUM(oi."price" * oi."quantity"), 0)::float8 AS revenue,
                   COALESCE(SUM(oi."quantity"), 0)::int AS units
            FROM "OrderItem" oi
            JOIN "Order" o ON o."id" = oi."orderId"
            LEFT JOIN "Product" p ON p."id" = oi."productId"
            LEFT JOIN "Category" c ON c."id" = p."categoryId"
            WHERE o."status" = 'COMPLETED' AND o."createdAt" >= ${startDate}
            GROUP BY c."id", c."name"
            ORDER BY revenue DESC
            LIMIT 8
        `,
        prisma.order.groupBy({
            by: ["userId"],
            _sum: { total: true },
            _count: { _all: true },
            where: { status: "COMPLETED", createdAt: { gte: startDate }, userId: { not: null } },
            orderBy: { _sum: { total: "desc" } },
            take: 8,
        }),
    ]);

    const buyers = await prisma.user.findMany({
        where: { id: { in: spenders.map((row) => row.userId as string) } },
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
                items: topRows.map((row) => {
                    const product = productById.get(row.productId!);
                    return {
                        id: row.productId!,
                        label: product?.name ?? row.productId!,
                        value: Number(row._sum.price || 0),
                        secondary: `${row._sum.quantity ?? 0}x`,
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
                items: byMethod.map((row) => ({
                    // A shop that took money before any gateway was named has
                    // rows with no method on them, and calling that zero would
                    // quietly drop revenue out of the report.
                    id: row.paymentMethod ?? "unrecorded",
                    label: row.paymentMethod ?? "Not recorded",
                    value: Number(row._sum.total || 0),
                    secondary: `${row._count._all}`,
                })),
            },
            {
                id: "store-by-category",
                label: "Revenue by category",
                labelKey: "analytics_storeByCategory",
                group: "store-catalogue",
                color: "#f59e0b",
                format: "currency",
                items: byCategory.map((row) => ({
                    id: row.id ?? "uncategorised",
                    label: row.name ?? "Uncategorised",
                    value: row.revenue,
                    secondary: `${row.units}x`,
                    href: row.id ? `/admin/store/categories` : undefined,
                })),
            },
            {
                id: "store-top-spenders",
                label: "Top spenders",
                labelKey: "analytics_storeTopSpenders",
                group: "store-buyers",
                color: "#ec4899",
                format: "currency",
                items: spenders.map((row) => ({
                    id: row.userId as string,
                    // A buyer whose account has since been deleted still spent
                    // the money, so the row stays and says so.
                    label: buyerById.get(row.userId as string) ?? "Deleted account",
                    value: Number(row._sum.total || 0),
                    secondary: `${row._count._all}`,
                    href: `/admin/users/${row.userId}`,
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
                data: labels.map((k) => Number(revenueByDay[k].toFixed(2))),
                color: "#10b981",
                format: "currency",
            },
            {
                id: "store-revenue-by-month",
                label: "Revenue by month",
                labelKey: "analytics_storeRevenueByMonth",
                group: "store-monthly",
                labels: monthly.map((row) => row.month),
                data: monthly.map((row) => Number(row.revenue.toFixed(2))),
                color: "#10b981",
                type: "bar",
                format: "currency",
            },
            {
                id: "store-orders-by-month",
                label: "Orders by month",
                labelKey: "analytics_storeOrdersByMonth",
                group: "store-monthly",
                labels: monthly.map((row) => row.month),
                data: monthly.map((row) => row.orders),
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
                    value: formatCurrency(Number(o.total)),
                })),
            },
        ],
    });
}
