import { NextRequest, NextResponse } from "next/server";
import { hasPermission, moduleSettings, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { creatorCodeCreateSchema } from "../../lib/validations";

// GET /api/v1/creator-codes - List (admin: all, user: own)
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const adminCheck = await hasPermission(session.user.id, "store.manage");
    const where = adminCheck ? {} : { creatorId: session.user.id };

    const codes = await prisma.creatorCode.findMany({
        where,
        include: { creator: { select: { id: true, username: true } } },
        orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ codes });
}

// POST /api/v1/creator-codes - Create (admin)
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const jsonBody = await readJsonBody(request);
    if (jsonBody instanceof NextResponse) return jsonBody;
    const parsed = creatorCodeCreateSchema.safeParse(jsonBody);
    if (!parsed.success) return NextResponse.json({ error: "Code and creator required" }, { status: 400 });
    const { code, creatorId, discountPercent, commissionPercent, productIds, categoryIds, isActive } = parsed.data;

    const existing = await prisma.creatorCode.findUnique({ where: { code: code.toUpperCase() } });
    if (existing) return NextResponse.json({ error: "Code already exists" }, { status: 400 });

    // Module settings rather than `creator_default_*` rows. Nothing wrote
    // those rows, so the two constants that stood behind them were the only
    // values a site ever had.
    const { creatorDefaultDiscount, creatorDefaultCommission } =
        await moduleSettings<{ creatorDefaultDiscount: number; creatorDefaultCommission: number }>("store");

    const creatorCode = await prisma.creatorCode.create({
        data: {
            code: code.toUpperCase(),
            creatorId,
            discountPercent: discountPercent || creatorDefaultDiscount,
            commissionPercent: commissionPercent || creatorDefaultCommission,
            productIds: productIds ?? [],
            categoryIds: categoryIds ?? [],
            isActive: isActive ?? true,
        },
    });
    return NextResponse.json({ creatorCode }, { status: 201 });
}
