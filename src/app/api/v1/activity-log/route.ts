import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { isAdmin } from "@/core/lib/permissions";
import { PER_PAGE_ACTIVITY } from "@/core/lib/constants";
import { pageParams } from "@/core/lib/page-params";

// GET /api/v1/activity-log - Admin only
export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { limit, skip, take } = pageParams(request.nextUrl.searchParams, {
        defaultLimit: PER_PAGE_ACTIVITY,
    });
    const action = request.nextUrl.searchParams.get("action");

    /*
     * The term narrows the query rather than the page.
     *
     * This table only ever grows, and the screen reading it shows twenty rows
     * at a time. Searching those twenty would answer that a thing an
     * administrator did last month never happened.
     *
     * The action and the entity: the two the table draws.
     */
    const term = (request.nextUrl.searchParams.get("q") ?? "").trim();
    const where = {
        ...(action ? { action } : {}),
        ...(term
            ? {
                OR: [
                    { action: { contains: term, mode: "insensitive" as const } },
                    { entity: { contains: term, mode: "insensitive" as const } },
                ],
            }
            : {}),
    };

    const [logs, total] = await Promise.all([
        prisma.activityLog.findMany({
            where,
            include: { user: { select: { id: true, username: true } } },
            orderBy: { createdAt: "desc" },
            skip,
            take,
        }),
        prisma.activityLog.count({ where }),
    ]);

    return NextResponse.json({ logs, total, pages: Math.ceil(total / limit) });
}
