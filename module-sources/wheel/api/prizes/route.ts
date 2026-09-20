import { NextRequest, NextResponse } from "next/server";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { wheelPrizeCreateSchema } from "../../lib/validations";

// GET - List prizes (admin sees all, public sees active only)
export async function GET(request: NextRequest) {
    const session = await auth();
    const adminCheck = session?.user?.id ? await isAdmin(session.user.id) : false;

    // A prize belongs to a wheel. `?wheelId=` is how the admin screen edits
    // one wheel's prizes without the others in the way.
    const wheelId = new URL(request.url).searchParams.get("wheelId");
    const where = {
        ...(adminCheck ? {} : { isActive: true }),
        ...(wheelId ? { wheelId } : {}),
    };

    // A visitor is drawing a wheel, not auditing it: name, colour, payout and
    // order are what a segment needs. `probability` is the number an operator
    // tunes in the admin screen, the public page has never read it, and the
    // wheel looks the same without it. An administrator gets the whole row,
    // because editing those odds is what their screen is for.
    const prizes = await prisma.wheelPrize.findMany({
        where,
        orderBy: { order: "asc" },
        ...(adminCheck ? {} : {
            select: { id: true, name: true, type: true, value: true, color: true, order: true, wheelId: true },
        }),
    });
    return NextResponse.json({ prizes });
}

// POST - Admin: create prize
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;
    const parsed = wheelPrizeCreateSchema.safeParse(jsonBody);
    if (!parsed.success) return NextResponse.json({ error: "Name and type required" }, { status: 400 });
    const { name, type, value, color, probability, order, wheelId, productId } = parsed.data;

    // A prize that says it hands something over has to say what. Refusing
    // here rather than at the column, because the column is nullable for
    // every other kind and the message an operator reads should name the
    // field they left empty.
    if (type === "product" && !productId) {
        return NextResponse.json(
            { error: "Pick what this prize hands over", code: "wheel_prize_needs_a_thing" },
            { status: 400 },
        );
    }

    // A prize with no wheel is a prize nobody can win, so one that names none
    // joins the first wheel the site has - which on an install with a single
    // wheel is the only answer there is.
    const wheel = wheelId
        ? await prisma.wheel.findUnique({ where: { id: wheelId }, select: { id: true } })
        : await prisma.wheel.findFirst({ orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true } });
    if (!wheel) return NextResponse.json({ error: "Create a wheel first" }, { status: 400 });

    const prize = await prisma.wheelPrize.create({
        data: {
            wheelId: wheel.id,
            name,
            type,
            productId: type === "product" ? productId : null,
            value: value || 0,
            color: color || "#3b82f6",
            probability: probability || 10,
            order: order || 0,
        },
    });
    return NextResponse.json({ prize }, { status: 201 });
}
