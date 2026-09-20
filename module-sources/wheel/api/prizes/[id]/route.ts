import { NextRequest, NextResponse } from "next/server";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { wheelPrizeUpdateSchema } from "../../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

// PATCH - Admin: update prize
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;

    const parsed = wheelPrizeUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const fields = parsed.data;

    const data: Record<string, unknown> = {};
    /*
     * A prize can be moved. This route read every other column and not this
     * one, and the screen had no box for it either, so a prize joined
     * whichever wheel came first and stayed there - on a site built to run
     * several wheels, exactly one of them could ever be filled.
     *
     * A wheel named here has to exist: a prize pointing at nothing is a prize
     * nobody can win, and the create route already refuses that.
     */
    if (fields.wheelId !== undefined && fields.wheelId) {
        const wheel = await prisma.wheel.findUnique({
            where: { id: fields.wheelId },
            select: { id: true },
        });
        if (!wheel) return NextResponse.json({ error: "No such wheel", code: "wheel_missing" }, { status: 400 });
        data.wheelId = wheel.id;
    }
    if (fields.name !== undefined) data.name = fields.name;
    if (fields.type !== undefined) data.type = fields.type;
    /*
     * What the prize hands over, and the kind it is, have to agree.
     *
     * A prize changed from `product` to `credits` keeps a thing it no longer
     * gives; one changed the other way promises a thing it has not been told
     * about. Both are the same broken promise, so the pair is settled here
     * against whichever of the two the request did not send.
     */
    if (fields.productId !== undefined || fields.type !== undefined) {
        const kind = fields.type ?? (await prisma.wheelPrize.findUnique({
            where: { id },
            select: { type: true },
        }))?.type;
        if (kind === "product") {
            const thing = fields.productId ?? (await prisma.wheelPrize.findUnique({
                where: { id },
                select: { productId: true },
            }))?.productId;
            if (!thing) {
                return NextResponse.json(
                    { error: "Pick what this prize hands over", code: "wheel_prize_needs_a_thing" },
                    { status: 400 },
                );
            }
            data.productId = thing;
        } else {
            data.productId = null;
        }
    }
    if (fields.value !== undefined) data.value = fields.value;
    if (fields.color !== undefined) data.color = fields.color;
    if (fields.probability !== undefined) data.probability = fields.probability;
    if (fields.order !== undefined) data.order = fields.order;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;

    const prize = await prisma.wheelPrize.update({ where: { id }, data });
    return NextResponse.json({ prize });
}

// DELETE - Admin: delete prize
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    await prisma.wheelPrize.delete({ where: { id } });
    return NextResponse.json({ message: "Deleted" });
}
