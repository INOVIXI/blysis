import { NextRequest, NextResponse } from "next/server";
import { dailySeries, dayLabels, hasPermission, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

/**
 * The dashboard and analytics screens are the only callers, and both are
 * behind the admin panel. Without this the endpoint answered anyone: an
 * anonymous request read the numbers straight out of the database.
 */
async function requireAdmin(): Promise<NextResponse | null> {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "blog.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return null;
}

export async function GET(request: NextRequest) {
    const denied = await requireAdmin();
    if (denied) return denied;

    const period = Math.min(
        365,
        Math.max(1, parseInt(request.nextUrl.searchParams.get("period") || "30", 10) || 30),
    );

    const articles = await prisma.blogArticle.count();

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - period);
    startDate.setHours(0, 0, 0, 0);

    // Grouped by the database. This used to read every row in the window and
    // bucket it here, so the work grew with the site's history to produce one
    // number per day.
    const series = await dailySeries({ table: "BlogArticle", since: startDate });

    const labels = dayLabels(startDate, period);
    const byDay: Record<string, number> = Object.fromEntries(labels.map((k) => [k, 0]));
    for (const row of series) {
        if (row.day in byDay) byDay[row.day] = row.count;
    }

    return NextResponse.json({
        stats: { articles },
        charts: [
            {
                id: "blog-articles",
                label: "Articles per day",
                labelKey: "analytics_blogArticlesPerDay",
                labels,
                data: labels.map((k) => byDay[k]),
                color: "#8b5cf6",
            },
        ],
        sections: [],
    });
}
