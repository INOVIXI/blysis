import { NextRequest, NextResponse } from "next/server";
import { pageParams, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { memberStatus } from "../../../lib/member-status";

/**
 * GET /api/v1/forms/submissions/mine - what the caller sent, and what was
 * decided about it.
 *
 * Scoped to the session's own id and nothing else, staff included: the
 * admin list is a different endpoint. The answers themselves are left out;
 * the member wrote them, and this list is about where each one stands. The
 * state is the member's reading of it (`memberStatus`), not the inbox step.
 */
export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Sign in to see what you sent", code: "sign_in_required" }, { status: 401 });
    }

    const { limit, skip, take } = pageParams(request.nextUrl.searchParams, { defaultLimit: 20 });
    const where = { userId: session.user.id };
    const [rows, total] = await Promise.all([
        prisma.customFormSubmission.findMany({
            where,
            select: {
                id: true,
                status: true,
                reviewNote: true,
                reviewedAt: true,
                createdAt: true,
                form: { select: { title: true, slug: true, isActive: true } },
            },
            orderBy: { createdAt: "desc" },
            skip,
            take,
        }),
        prisma.customFormSubmission.count({ where }),
    ]);

    return NextResponse.json({
        submissions: rows.map((row) => ({ ...row, status: memberStatus(row.status) })),
        total,
        pages: Math.ceil(total / limit),
    });
}
