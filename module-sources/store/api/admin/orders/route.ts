import { NextRequest, NextResponse } from "next/server";
import { generateOrderNumber } from "@/core/sdk";
import { hasPermission, log, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { manualOrderTotal } from "../../../lib/manual-order";
import { settleOrder } from "../../../lib/fulfilment";
import { manualOrderSchema } from "../../../lib/validations";

/**
 * POST /api/v1/store/admin/orders - an order an operator types in.
 *
 * For what the checkout cannot reach: money that arrived by bank transfer, a
 * replacement for an order that went wrong, a sale agreed in a message.
 *
 * It takes no money. What it does instead is the thing worth being careful
 * about: an order marked paid has to grant what was bought - the chest, the
 * ownership, the role, the delivery, the stock coming off the shelf - and
 * doing that here would be a second copy of the settlement path, drifting
 * from the first the day either changes. So the order is written unpaid and
 * handed to `settleOrder`, exactly as a gateway's webhook would.
 */
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await hasPermission(session.user.id, "store.orders"))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = manualOrderSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { userId, currency, notes, markPaid, lines } = parsed.data;

    const summed = manualOrderTotal(lines);
    if ("bad" in summed) {
        // The route's own words, naming the row the operator is looking at.
        return NextResponse.json(
            {
                error: summed.bad.reason === "negative"
                    ? `Line ${summed.bad.line} needs a price of zero or more and at least one of it.`
                    : `Line ${summed.bad.line} is not a number.`,
                code: "manual_order_bad_line",
                line: summed.bad.line,
            },
            { status: 400 },
        );
    }
    const total = summed.total;

    const buyer = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!buyer) return NextResponse.json({ error: "That account no longer exists" }, { status: 400 });

    const products = await prisma.product.findMany({
        where: { id: { in: [...new Set(lines.map((line) => line.productId))] } },
        select: { id: true, name: true },
    });
    const named = new Map(products.map((product) => [product.id, product.name]));
    const missing = lines.find((line) => !named.has(line.productId));
    if (missing) {
        return NextResponse.json({ error: "One of the chosen products no longer exists" }, { status: 400 });
    }

    const order = await prisma.order.create({
        data: {
            orderNumber: generateOrderNumber(),
            status: "PENDING",
            total,
            subtotal: total,
            currency: currency.toUpperCase(),
            notes: notes || null,
            userId: buyer.id,
            // Says where it came from without naming a gateway: nothing was
            // charged, and a report that treats this as card revenue is wrong.
            metadata: { enteredBy: session.user.id, manual: true },
            items: {
                create: lines.map((line) => ({
                    productId: line.productId,
                    name: named.get(line.productId) as string,
                    quantity: line.quantity,
                    price: line.unitAmount,
                })),
            },
        },
        include: { items: true },
    });

    await logActivity({
        userId: session.user.id,
        action: "store.order.entered",
        entity: "order",
        entityId: order.id,
        metadata: { orderNumber: order.orderNumber, total, markPaid },
    }).catch(() => {});

    if (!markPaid) return NextResponse.json({ order }, { status: 201 });

    // The same path a gateway's webhook takes, so an order entered by hand
    // grants exactly what one paid for online does.
    const settled = await settleOrder({
        kind: "order",
        reference: order.id,
        provider: "manual",
        providerRef: `manual:${order.id}`,
        amount: total,
        currency: order.currency,
    });
    if (!settled.handled) {
        log.error("Manual order could not be settled", { orderId: order.id });
        return NextResponse.json(
            { error: "The order was created but could not be marked paid.", orderId: order.id },
            { status: 500 },
        );
    }

    const paid = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true } });
    return NextResponse.json({ order: paid }, { status: 201 });
}
