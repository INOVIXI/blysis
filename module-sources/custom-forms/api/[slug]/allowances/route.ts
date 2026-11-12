import { NextRequest, NextResponse } from "next/server";
import { isAdmin, logActivity, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { periodWhere } from "../../../lib/allowance";

/**
 * A form's allowance period: when it started and how many members have
 * applied in it (GET), and starting a new one (POST).
 *
 * A reset moves `limitPeriodStart` to now. Nothing is deleted: what was sent
 * before stays in the list with its decision, it just stops counting against
 * the person who sent it.
 */

type RouteParams = { params: Promise<{ slug: string }> };

async function requireAdmin(): Promise<string | NextResponse> {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return session.user.id;
}

async function findForm(slug: string) {
    return prisma.customForm.findFirst({
        where: { OR: [{ slug }, { id: slug }] },
        select: { id: true, limitPeriodStart: true, createdAt: true },
    });
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
    const who = await requireAdmin();
    if (who instanceof NextResponse) return who;

    const form = await findForm((await params).slug);
    if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // One row per member; the Set is what counts them, so the answer does
    // not depend on the database honouring `distinct`.
    const applied = await prisma.customFormSubmission.findMany({
        where: { ...periodWhere(form), userId: { not: null } },
        select: { userId: true },
        distinct: ["userId"],
    });
    return NextResponse.json({
        // Never reset means the period is the form's whole life.
        periodStart: form.limitPeriodStart ?? form.createdAt,
        members: new Set(applied.map((row) => row.userId)).size,
    });
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
    const who = await requireAdmin();
    if (who instanceof NextResponse) return who;

    const form = await findForm((await params).slug);
    if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.customForm.update({
        where: { id: form.id },
        data: { limitPeriodStart: new Date() },
        select: { id: true, limitPeriodStart: true },
    });
    // Every member's allowance came back on one person's say-so.
    logActivity({
        userId: who,
        action: "custom_form.allowances_reset",
        entity: "CustomForm",
        entityId: form.id,
        metadata: { previousStart: form.limitPeriodStart },
    }).catch(() => {});
    return NextResponse.json({ periodStart: updated.limitPeriodStart, members: 0 });
}
