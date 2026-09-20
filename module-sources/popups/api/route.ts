import { NextRequest, NextResponse } from "next/server";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { popupSchema } from "../lib/validations";

/**
 * GET /api/v1/popups - what a visitor is shown, and what the panel manages.
 *
 * The visitor's answer is one popup: the live one, inside its window. The
 * panel used to read that same answer, so an operator with three popups saw
 * one row, a popup scheduled for next week was invisible on the only screen
 * that could move it, and one that had ended could not be found to be brought
 * back.
 *
 * `scope=admin` is the operator's answer, and it is refused to anybody who
 * could not open the screen that asks for it: a popup that has not started is
 * something the site has not said yet.
 */
export async function GET(request: NextRequest) {
    if (new URL(request.url).searchParams.get("scope") === "admin") {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

        const popups = await prisma.popup.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
        return NextResponse.json({ popups });
    }

    const now = new Date();
    const popups = await prisma.popup.findMany({
        where: {
            isActive: true,
            OR: [{ startsAt: null }, { startsAt: { lte: now } }],
            AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
        },
        orderBy: { createdAt: "desc" },
        take: 1,
    });
    return NextResponse.json({ popups });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = popupSchema.safeParse(body);
    if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
    }
    const data = validation.data;
    const popup = await prisma.popup.create({
        data: {
            title: data.title,
            content: data.content ?? null,
            image: data.image ?? null,
            link: data.link ?? null,
            linkText: data.linkText ?? null,
            isActive: data.isActive ?? true,
            startsAt: data.startsAt ?? null,
            endsAt: data.endsAt ?? null,
        },
    });
    return NextResponse.json({ popup }, { status: 201 });
}
