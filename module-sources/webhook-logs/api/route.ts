import { NextRequest, NextResponse } from "next/server";
import { pageParams, isAdmin, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const limit = 50;
    const { page, skip, take } = pageParams(request.nextUrl.searchParams, { fixedLimit: limit });

    /*
     * The term narrows the query rather than the page.
     *
     * This table is the delivery history of every webhook the site has ever
     * sent, so it is the longest list in the panel and the one an operator
     * only ever opens to find one delivery. Searching the fifty rows that
     * happened to arrive would answer that the delivery never happened.
     *
     * The event and the address: the two the table draws.
     */
    const term = (request.nextUrl.searchParams.get("q") ?? "").trim();
    const where = term === ""
        ? {}
        : {
            OR: [
                { event: { contains: term, mode: "insensitive" as const } },
                { url: { contains: term, mode: "insensitive" as const } },
            ],
        };

    const [logs, total] = await Promise.all([
        prisma.webhookLog.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take,
        }),
        prisma.webhookLog.count({ where }),
    ]);

    return NextResponse.json({ logs, total, pages: Math.ceil(total / limit) });
}
