import { NextRequest, NextResponse } from "next/server";
import { hasPermission, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { STORE_SALE_SELECT, storeSaleWrite } from "../../../lib/store-sale-server";
import { storeSaleSchema } from "../../../lib/validations";

/**
 * The store-wide sales, for the panel: every one, running, scheduled, ended
 * or switched off, because the screen that lists them is the only way to edit
 * or remove one.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const sales = await prisma.storeSale.findMany({
        select: STORE_SALE_SELECT,
        orderBy: { startsAt: "desc" },
        take: 200,
    });
    return NextResponse.json({ sales }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = storeSaleSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    const write = await storeSaleWrite(parsed.data);
    if (!write.ok) return NextResponse.json({ error: write.error, code: write.code }, { status: 400 });

    const sale = await prisma.storeSale.create({ data: write.data, select: STORE_SALE_SELECT });
    await logActivity({
        userId: session.user.id,
        action: "store.sale.created",
        entity: "store_sale",
        entityId: sale.id,
        metadata: { name: sale.name, percent: sale.percent },
    }).catch(() => {});

    return NextResponse.json({ sale }, { status: 201 });
}
