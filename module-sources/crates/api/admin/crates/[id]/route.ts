import { NextRequest, NextResponse } from "next/server";
import { hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { crateSchema } from "../../../../lib/validations";

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
    const parsed = crateSchema.partial().safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

    const { roleId, ...fields } = parsed.data;
    if (fields.slug) {
        const taken = await prisma.crateBox.findFirst({ where: { slug: fields.slug, NOT: { id } }, select: { id: true } });
        if (taken) return NextResponse.json({ error: "That address is taken", code: "crate_slug_taken" }, { status: 409 });
    }
    const crate = await prisma.crateBox.update({
        where: { id },
        data: {
            ...fields,
            ...(fields.keyProductId === undefined ? {} : { keyProductId: fields.keyProductId || null }),
            ...(roleId === undefined ? {} : { roleIds: roleId ? [roleId] : [] }),
        },
    });
    return NextResponse.json({ crate });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const refused = await refuse();
    if (refused) return refused;

    const { id } = await params;
    // The rewards and the keys on members' rings go with it, because the row
    // owns them. The openings stay with their crate set to null and the
    // crate's name copied on them: a member's history is not the operator's
    // to delete along with a crate they retired. A member holding bought keys
    // loses them, which is why the screen asks first and why switching a
    // crate off is the gentler way out.
    await prisma.crateBox.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
}
