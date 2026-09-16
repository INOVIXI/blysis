import { NextRequest, NextResponse } from "next/server";
import { hasPermission, log, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { campaignSchema } from "../../lib/validations";

/**
 * Campaigns, for the screen that sets them.
 *
 * Admin only and never cached: what a campaign says is what a shop is about
 * to charge, and an operator editing one has to see their own change rather
 * than the answer from a minute ago.
 */

const PRIVATE = { "Cache-Control": "private, no-store" };

async function refuse(): Promise<NextResponse | null> {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
    }
    if (!(await hasPermission(session.user.id, "store.manage"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE });
    }
    return null;
}

export async function GET() {
    const refused = await refuse();
    if (refused) return refused;

    // Newest first, with a ceiling. Campaigns are made by hand so the table
    // grows slowly, but it does grow: an old one is kept rather than deleted,
    // and an admin screen that reads every row eventually reads a thousand.
    // A shop past this many wants a paged screen, not a bigger number here.
    const campaigns = await prisma.campaign.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { entries: { select: { productId: true, price: true, stock: true } } },
    });
    return NextResponse.json({ campaigns }, { headers: PRIVATE });
}

export async function POST(request: NextRequest) {
    const refused = await refuse();
    if (refused) return refused;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = campaignSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { entries = [], ...fields } = parsed.data;
    try {
        const campaign = await prisma.campaign.create({
            data: {
                ...fields,
                days: fields.days ?? [],
                entries: { create: entries },
            },
            include: { entries: true },
        });
        return NextResponse.json({ campaign }, { status: 201, headers: PRIVATE });
    } catch (error) {
        // A product id that names nothing is the one way this fails from a
        // form: the list was loaded, something was deleted, and the operator
        // saved the stale page.
        log.error("Create campaign error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "One of the chosen products no longer exists." },
            { status: 400 },
        );
    }
}
