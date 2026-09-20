import { NextRequest, NextResponse } from "next/server";
import { pageParams, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

/**
 * GET /api/v1/credits - a member's balance and the ledger behind it.
 *
 * Query: ?page=1&limit=10
 *
 * It answered with the last twenty rows and no way to ask for the twenty-first,
 * which is the shape of every wallet screen that has been used for a while:
 * the balance is right and the history that explains it stops. The index on
 * `[userId, createdAt]` is there for exactly this read.
 */
export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { page, limit, skip, take } = pageParams(request.nextUrl.searchParams, { defaultLimit: 10, maxLimit: 50 });

    const where = { userId: session.user.id };
    const [user, history, total] = await Promise.all([
        prisma.user.findUnique({
            where: { id: session.user.id },
            select: { creditBalance: true },
        }),
        prisma.creditTransaction.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take,
        }),
        prisma.creditTransaction.count({ where }),
    ]);

    return NextResponse.json({
        balance: Number(user?.creditBalance || 0),
        history,
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
}
