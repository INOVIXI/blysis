import { NextRequest, NextResponse } from "next/server";
import { hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { crateSchema } from "../../../lib/validations";

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

/**
 * Every crate, including the switched-off ones, for the screen that manages
 * them. The public listing at /api/v1/crates/crates hides what is off and the
 * weights behind the odds; an operator needs both.
 */
export async function GET() {
    const refused = await refuse();
    if (refused) return refused;

    const crates = await prisma.crateBox.findMany({
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        take: 200,
    });
    // `roleId` is what the form writes: one role is the question an operator
    // asks, and the column stays a list so several stay possible.
    return NextResponse.json(
        { crates: crates.map((crate) => ({ ...crate, roleId: crate.roleIds[0] ?? "" })) },
        { headers: PRIVATE },
    );
}

export async function POST(request: NextRequest) {
    const refused = await refuse();
    if (refused) return refused;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = crateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

    const taken = await prisma.crateBox.findUnique({ where: { slug: parsed.data.slug }, select: { id: true } });
    if (taken) return NextResponse.json({ error: "That address is taken", code: "crate_slug_taken" }, { status: 409 });

    const { roleId, ...fields } = parsed.data;
    const crate = await prisma.crateBox.create({
        data: { ...fields, keyProductId: fields.keyProductId || null, roleIds: roleId ? [roleId] : [] },
    });
    return NextResponse.json({ crate }, { status: 201, headers: PRIVATE });
}
