import { NextRequest, NextResponse } from "next/server";
import { hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { rewardSchema } from "../../../lib/validations";

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

/** Every reward in every crate, weights included, for the screen that tunes them. */
export async function GET(request: NextRequest) {
    const refused = await refuse();
    if (refused) return refused;

    // `?crateId=` edits one crate's rewards without the others in the way.
    const crateId = new URL(request.url).searchParams.get("crateId");
    const rewards = await prisma.crateReward.findMany({
        where: crateId ? { crateId } : {},
        orderBy: [{ crateId: "asc" }, { order: "asc" }],
        take: 1000,
    });
    return NextResponse.json({ rewards }, { headers: PRIVATE });
}

export async function POST(request: NextRequest) {
    const refused = await refuse();
    if (refused) return refused;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = rewardSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const { productId, ...fields } = parsed.data;

    // A reward that says it hands a product over has to say which, and the
    // message names the field that was left empty.
    if (fields.kind === "product" && !productId) {
        return NextResponse.json({ error: "Pick what this reward hands over", code: "crate_reward_needs_a_product" }, { status: 400 });
    }
    const crate = await prisma.crateBox.findUnique({ where: { id: fields.crateId }, select: { id: true } });
    if (!crate) return NextResponse.json({ error: "No such crate", code: "crate_missing" }, { status: 400 });

    const reward = await prisma.crateReward.create({
        data: { ...fields, productId: fields.kind === "product" ? productId : null },
    });
    return NextResponse.json({ reward }, { status: 201, headers: PRIVATE });
}
