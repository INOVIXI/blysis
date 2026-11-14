import { NextRequest, NextResponse } from "next/server";
import { hasPermission, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { CAMPAIGN_SELECT, campaignWrite } from "../../../../lib/credit-bonus-server";
import { creditBonusCampaignSchema } from "../../../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

/** Saves the whole form: an edit is checked exactly as a create is. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = creditBonusCampaignSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const write = await campaignWrite(parsed.data);
    if (!write.ok) return NextResponse.json({ error: write.error, code: write.code }, { status: 400 });

    const updated = await prisma.creditBonusCampaign.updateMany({ where: { id }, data: write.data });
    if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await logActivity({
        userId: session.user.id,
        action: "store.credit_bonus.updated",
        entity: "credit_bonus_campaign",
        entityId: id,
    }).catch(() => {});

    const campaign = await prisma.creditBonusCampaign.findUnique({ where: { id }, select: CAMPAIGN_SELECT });
    return NextResponse.json({ campaign });
}

/**
 * Deleted outright. A top-up started under it carries its own bonus number,
 * so removing the campaign changes no payment already on its way.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const removed = await prisma.creditBonusCampaign.deleteMany({ where: { id } });
    if (removed.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await logActivity({
        userId: session.user.id,
        action: "store.credit_bonus.deleted",
        entity: "credit_bonus_campaign",
        entityId: id,
    }).catch(() => {});

    return NextResponse.json({ deleted: true });
}
