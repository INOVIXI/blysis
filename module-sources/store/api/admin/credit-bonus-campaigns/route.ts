import { NextRequest, NextResponse } from "next/server";
import { hasPermission, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { CAMPAIGN_SELECT, campaignWrite } from "../../../lib/credit-bonus-server";

/**
 * The credit bonus campaigns, for the panel: every one, running, ended or
 * switched off, because the screen that lists them is the only way to edit
 * or remove one.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const campaigns = await prisma.creditBonusCampaign.findMany({
        select: CAMPAIGN_SELECT,
        orderBy: { startsAt: "desc" },
        take: 200,
    });
    return NextResponse.json({ campaigns }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const write = await campaignWrite(body);
    if (!write.ok) return NextResponse.json({ error: write.error, code: write.code }, { status: 400 });

    const campaign = await prisma.creditBonusCampaign.create({ data: write.data, select: CAMPAIGN_SELECT });
    await logActivity({
        userId: session.user.id,
        action: "store.credit_bonus.created",
        entity: "credit_bonus_campaign",
        entityId: campaign.id,
        metadata: { name: campaign.name },
    }).catch(() => {});

    return NextResponse.json({ campaign }, { status: 201 });
}
