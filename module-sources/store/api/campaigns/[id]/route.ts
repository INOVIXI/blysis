import { NextRequest, NextResponse } from "next/server";
import { hasPermission, log, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { campaignSchema } from "../../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

async function refuse(): Promise<NextResponse | null> {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return null;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const refused = await refuse();
    if (refused) return refused;

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = campaignSchema.partial().safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const existing = await prisma.campaign.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const { entries, ...fields } = parsed.data;
    try {
        // The list of what is in a campaign is replaced rather than merged:
        // the form sends the whole list every time, so a product taken off it
        // has to come off here too, and a merge would leave it on sale.
        const campaign = await prisma.$transaction(async (tx) => {
            if (entries) {
                await tx.campaignEntry.deleteMany({ where: { campaignId: id } });
                if (entries.length > 0) {
                    await tx.campaignEntry.createMany({
                        data: entries.map((entry) => ({ ...entry, campaignId: id })),
                    });
                }
            }
            return tx.campaign.update({
                where: { id },
                data: fields,
                include: { entries: true },
            });
        });
        return NextResponse.json({ campaign });
    } catch (error) {
        log.error("Update campaign error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "One of the chosen products no longer exists." },
            { status: 400 },
        );
    }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const refused = await refuse();
    if (refused) return refused;

    const { id } = await params;
    // The entries go with it; the products do not.
    await prisma.campaign.deleteMany({ where: { id } });
    return NextResponse.json({ deleted: true });
}
