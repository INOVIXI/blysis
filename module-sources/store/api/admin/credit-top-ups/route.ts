/**
 * GET /api/v1/store/admin/credit-top-ups - every credit top-up a buyer started, newest first (admin).
 *
 * Query: ?page=1&status=PENDING|COMPLETED|CANCELLED|REFUNDED&provider=&q=
 *
 * A top-up is a payment like an order, and until now an operator could only
 * see one by finding its row in the database: a buyer asking where their
 * credits went had nobody who could look. `REFUNDED` is a completed top-up
 * whose money went back, which the status column alone does not say.
 */
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { hasPermission, pageParams, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";

const STATUSES = ["PENDING", "COMPLETED", "CANCELLED"] as const;

export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const params = request.nextUrl.searchParams;
    const { page, limit, skip, take } = pageParams(params, { defaultLimit: 25 });
    const asked = (params.get("status") ?? "").trim().toUpperCase();
    const provider = (params.get("provider") ?? "").trim().slice(0, 64);
    const term = (params.get("q") ?? "").trim().slice(0, 64);

    const where: Prisma.CreditTopUpWhereInput = {
        // The column is an enum, so a word that is not one of its members
        // would be an error from the database; anything else is no filter.
        ...(asked === "REFUNDED"
            ? { refundedAt: { not: null } }
            : (STATUSES as readonly string[]).includes(asked)
                ? { status: asked as (typeof STATUSES)[number], ...(asked === "COMPLETED" ? { refundedAt: null } : {}) }
                : {}),
        ...(provider ? { provider } : {}),
        ...(term ? { user: { username: { contains: term, mode: "insensitive" } } } : {}),
    };

    const [rows, total, providers] = await Promise.all([
        prisma.creditTopUp.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take,
            select: {
                id: true,
                credits: true,
                bonusCredits: true,
                amount: true,
                fee: true,
                currency: true,
                provider: true,
                providerRef: true,
                status: true,
                refundedAt: true,
                createdAt: true,
                user: { select: { id: true, username: true } },
            },
        }),
        prisma.creditTopUp.count({ where }),
        // The gateways this site has taken a top-up through, for the filter.
        prisma.creditTopUp.groupBy({ by: ["provider"], orderBy: { provider: "asc" } }),
    ]);

    return NextResponse.json({
        topUps: rows.map((row) => ({ ...row, amount: Number(row.amount), fee: Number(row.fee) })),
        providers: providers.map((row) => row.provider),
        page,
        limit,
        total,
    });
}
