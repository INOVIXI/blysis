/**
 * GET /api/v1/credits/admin/ledger - every member's credit ledger, newest first (admin).
 *
 * Query: ?page=1&userId=&type=&direction=in|out
 *
 * Where credits went and came from across the site: spending, top-ups,
 * prizes, transfers and changes made by hand. Narrowed to one member it also
 * answers with their balance, which is what the screen that changes a
 * balance shows before the change.
 */
import { NextRequest, NextResponse } from "next/server";
import { hasPermission, pageParams, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "credits.view"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const params = request.nextUrl.searchParams;
    const { page, limit, skip, take } = pageParams(params, { defaultLimit: 25 });
    const userId = (params.get("userId") ?? "").trim().slice(0, 64) || null;
    const type = (params.get("type") ?? "").trim().slice(0, 64) || null;
    const direction = params.get("direction");

    const where = {
        ...(userId ? { userId } : {}),
        ...(type ? { type } : {}),
        ...(direction === "in" ? { amount: { gt: 0 } } : direction === "out" ? { amount: { lt: 0 } } : {}),
    };

    const [rows, total, types, member] = await Promise.all([
        prisma.creditTransaction.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take,
            select: {
                id: true,
                amount: true,
                type: true,
                description: true,
                createdAt: true,
                user: { select: { id: true, username: true } },
            },
        }),
        prisma.creditTransaction.count({ where }),
        // The kinds of row this site has actually written, for the filter:
        // any module may write its own word, so a fixed list would miss one.
        prisma.creditTransaction.groupBy({ by: ["type"] }),
        userId ? prisma.user.findUnique({ where: { id: userId }, select: { creditBalance: true } }) : Promise.resolve(null),
    ]);

    return NextResponse.json({
        entries: rows.map((row) => ({ ...row, amount: Number(row.amount) })),
        types: types.map((row) => row.type).sort(),
        balance: member ? Number(member.creditBalance) : null,
        page,
        limit,
        total,
    });
}
