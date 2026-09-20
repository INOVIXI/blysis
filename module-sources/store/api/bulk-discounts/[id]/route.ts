import { NextRequest, NextResponse } from "next/server";
import { hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { bulkDiscountUpdateSchema } from "../../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

// PATCH /api/v1/store/bulk-discounts/[id] - Update (admin)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.bulkDiscount.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Bulk discount not found" }, { status: 404 });

    const body = await readJsonBody(request, { fallback: {} });
    if (body instanceof NextResponse) return body;
    const parsed = bulkDiscountUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const fields = parsed.data;

    const data: Record<string, unknown> = {};
    if (fields.name !== undefined) data.name = fields.name;
    if (fields.minQuantity !== undefined) data.minQuantity = fields.minQuantity;
    if (fields.discountPercent !== undefined) data.discountPercent = fields.discountPercent;
    if (fields.productIds !== undefined) data.productIds = fields.productIds;
    if (fields.categoryIds !== undefined) data.categoryIds = fields.categoryIds;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;

    const updated = await prisma.bulkDiscount.update({ where: { id }, data });
    return NextResponse.json({ bulkDiscount: updated });
}

// DELETE /api/v1/store/bulk-discounts/[id] - Delete (admin)
export async function DELETE(_: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.bulkDiscount.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Bulk discount not found" }, { status: 404 });

    await prisma.bulkDiscount.delete({ where: { id } });
    return NextResponse.json({ ok: true });
}
