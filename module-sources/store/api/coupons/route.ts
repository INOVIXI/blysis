import { NextRequest, NextResponse } from "next/server";
import { hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { couponSchema } from "../../lib/validations";

/**
 * Most rows this list will hand back at once.
 *
 * The table fills up while the site is used, so reading all of it gets slower
 * every week and says nothing until the screen stops answering. One more than
 * the ceiling is fetched so the answer can admit it was cut rather than look
 * complete.
 */
const MAX_ROWS = 500;

// GET /api/v1/store/coupons
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await hasPermission(session.user.id, "store.manage");
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rows = await prisma.coupon.findMany({
        orderBy: { createdAt: "desc" },
        take: MAX_ROWS + 1,
    });

    return NextResponse.json({
        coupons: rows.slice(0, MAX_ROWS),
        truncated: rows.length > MAX_ROWS,
    });
}

// POST /api/v1/store/coupons
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await hasPermission(session.user.id, "store.manage");
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = couponSchema.safeParse(body);

    if (!validation.success) {
        return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
    }

    const existing = await prisma.coupon.findUnique({
        where: { code: validation.data.code },
    });
    if (existing) {
        return NextResponse.json({ error: "Coupon code already exists" }, { status: 400 });
    }

    const coupon = await prisma.coupon.create({
        data: {
            ...validation.data,
            startsAt: validation.data.startsAt ? new Date(validation.data.startsAt) : null,
            expiresAt: validation.data.expiresAt ? new Date(validation.data.expiresAt) : null,
        },
    });

    return NextResponse.json({ coupon }, { status: 201 });
}
