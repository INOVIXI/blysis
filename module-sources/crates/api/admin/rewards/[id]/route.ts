import { NextRequest, NextResponse } from "next/server";
import { hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { rewardSchema } from "../../../../lib/validations";

/** This answer depends on who asked, so nothing may keep a copy of it. */
const PRIVATE = { "Cache-Control": "private, no-store" };

/** 401 when nobody is signed in, 403 when they may not manage crates. */
async function refuse(): Promise<NextResponse | null> {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
    if (!(await hasPermission(session.user.id, "crates.manage"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE });
    }
    return null;
}

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const refused = await refuse();
    if (refused) return refused;

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = rewardSchema.partial().safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const { productId, ...fields } = parsed.data;

    const current = await prisma.crateReward.findUnique({ where: { id }, select: { kind: true, productId: true } });
    if (!current) return NextResponse.json({ error: "No such reward", code: "crate_reward_missing" }, { status: 404 });

    if (fields.crateId) {
        const crate = await prisma.crateBox.findUnique({ where: { id: fields.crateId }, select: { id: true } });
        if (!crate) return NextResponse.json({ error: "No such crate", code: "crate_missing" }, { status: 400 });
    }

    // The kind and what it hands over have to agree, settled against
    // whichever of the two the request did not send.
    const kind = fields.kind ?? current.kind;
    const thing = productId === undefined ? current.productId : productId;
    if (kind === "product" && !thing) {
        return NextResponse.json({ error: "Pick what this reward hands over", code: "crate_reward_needs_a_product" }, { status: 400 });
    }

    const reward = await prisma.crateReward.update({
        where: { id },
        data: { ...fields, productId: kind === "product" ? thing : null },
    });
    return NextResponse.json({ reward });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const refused = await refuse();
    if (refused) return refused;

    const { id } = await params;
    // Openings that drew it keep its name, value and rarity on their own row.
    await prisma.crateReward.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
}
