/**
 * POST /api/v1/credits/admin/adjust - add credits to a member's balance or take them off, with a reason (admin).
 *
 * The rules are `adjust.ts`. Who made the change and why goes to the
 * activity log; the reason alone goes on the ledger row the member reads.
 */
import { NextRequest, NextResponse } from "next/server";
import { hasPermission, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { doActionAsync } from "@/core/sdk";
import { auth } from "@/core/sdk/auth";
import { adjustBalance, adjustmentRefusal } from "../../../../lib/adjust";
import { creditAdjustSchema } from "../../../../lib/validations";

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "credits.manage"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = creditAdjustSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const adjustment = { ...parsed.data, reason: parsed.data.reason.trim() };

    const member = await prisma.user.findUnique({
        where: { id: adjustment.userId },
        select: { id: true, username: true, creditBalance: true },
    });
    if (!member) {
        return NextResponse.json({ error: "credits_adjust_no_member", code: "credits_adjust_no_member" }, { status: 404 });
    }

    const refusal = adjustmentRefusal(adjustment, Number(member.creditBalance));
    if (refusal) {
        return NextResponse.json({ error: refusal, code: refusal }, { status: refusal === "credits_adjust_below_zero" ? 409 : 400 });
    }

    const balance = await prisma.$transaction(async (tx) => {
        if (!(await adjustBalance(tx, adjustment))) return null;
        const after = await tx.user.findUniqueOrThrow({ where: { id: adjustment.userId }, select: { creditBalance: true } });
        return Number(after.creditBalance);
    });
    // Spent between the read above and the debit: the conditional debit is
    // the one that decides.
    if (balance === null) {
        return NextResponse.json(
            { error: "credits_adjust_below_zero", code: "credits_adjust_below_zero" },
            { status: 409 },
        );
    }

    logActivity({
        userId: session.user.id,
        action: "credits.balance.adjusted",
        entity: "user",
        entityId: member.id,
        metadata: {
            member: member.username,
            amount: adjustment.amount,
            reason: adjustment.reason,
            belowZeroAllowed: Boolean(adjustment.allowNegative),
            balance,
        },
    }).catch(() => {});

    // The member hears about credits they were given, as they would about any
    // other credits arriving. A removal is told by the row in their history.
    if (adjustment.amount > 0) {
        await doActionAsync("credits.credit.added", {
            userId: member.id,
            amount: adjustment.amount,
            type: "admin_grant",
            grantedBy: session.user.id,
        });
    }

    return NextResponse.json({ balance });
}
