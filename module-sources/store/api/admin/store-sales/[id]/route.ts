import { NextRequest, NextResponse } from "next/server";
import { hasPermission, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { STORE_SALE_SELECT, storeSaleWrite } from "../../../../lib/store-sale-server";

type RouteParams = { params: Promise<{ id: string }> };

/** Saves the whole form: an edit is checked exactly as a create is. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const write = await storeSaleWrite(body);
    if (!write.ok) return NextResponse.json({ error: write.error, code: write.code }, { status: 400 });

    const updated = await prisma.storeSale.updateMany({ where: { id }, data: write.data });
    if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await logActivity({
        userId: session.user.id,
        action: "store.sale.updated",
        entity: "store_sale",
        entityId: id,
    }).catch(() => {});

    const sale = await prisma.storeSale.findUnique({ where: { id }, select: STORE_SALE_SELECT });
    return NextResponse.json({ sale });
}

/**
 * Deleted outright. An order placed during the sale already carries the price
 * it was charged, so removing the sale changes no order.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const removed = await prisma.storeSale.deleteMany({ where: { id } });
    if (removed.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await logActivity({
        userId: session.user.id,
        action: "store.sale.deleted",
        entity: "store_sale",
        entityId: id,
    }).catch(() => {});

    return NextResponse.json({ deleted: true });
}
