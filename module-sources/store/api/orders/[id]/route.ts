import { NextRequest, NextResponse } from "next/server";
import { hasPermission, log, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { z } from "zod";
import { settleOrder, voidOrder, refundPayment } from "../../../lib/fulfilment";

const orderUpdateSchema = z.object({
    status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "CANCELLED", "REFUNDED"]).optional(),
    notes: z.string().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/v1/store/orders/[id] - Get single order
export async function GET(_request: NextRequest, { params }: RouteParams) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;

        // First-pass fetch just enough to decide ownership. We defer the
        // expensive include until after the permission check so an attacker
        // who guesses another user's order id can't even elicit a latency
        // signal from the payments join.
        const ownership = await prisma.order.findFirst({
            where: { OR: [{ id }, { orderNumber: id }] },
            select: { id: true, userId: true },
        });
        if (!ownership) {
            return NextResponse.json({ error: "Order not found" }, { status: 404 });
        }

        const adminCheck = await hasPermission(session.user.id, "store.orders");
        const isOwner = ownership.userId === session.user.id;
        if (!adminCheck && !isOwner) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        // Safe projection for the full payload. `Payment.metadata` is the
        // raw provider webhook body (can include PANs / PII / tokens) so we
        // never echo it to the client - only the summary fields go out.
        // The `user.email` field is restricted to admins.
        const order = await prisma.order.findUnique({
            where: { id: ownership.id },
            include: {
                user: {
                    select: adminCheck
                        ? { id: true, username: true, email: true, avatar: true }
                        : { id: true, username: true, avatar: true },
                },
                items: {
                    include: {
                        product: {
                            select: { id: true, name: true, slug: true, image: true },
                        },
                    },
                },
                payments: {
                    select: {
                        id: true,
                        amount: true,
                        currency: true,
                        status: true,
                        provider: true,
                        providerId: adminCheck,
                        createdAt: true,
                    },
                },
            },
        });

        return NextResponse.json({ order });
    } catch (error) {
        log.error("Get order error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

// PATCH /api/v1/store/orders/[id] - Update order (admin)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const adminCheck = await hasPermission(session.user.id, "store.orders");
        if (!adminCheck) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const { id } = await params;
        const body = await readJsonBody(request);
        if (body instanceof NextResponse) return body;
        const validation = orderUpdateSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { error: validation.error.issues[0].message },
                { status: 400 }
            );
        }

        const existing = await prisma.order.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json({ error: "Order not found" }, { status: 404 });
        }

        // Three of the five statuses are not a column, they are a thing that
        // happens to an order: what was bought is granted, or the stock goes
        // back, or the money does. Writing the word and nothing else is how
        // this screen used to confirm a bank transfer, and the buyer got
        // nothing while the screen turned green.
        //
        // Each goes down the path a gateway's callback takes, so there is one
        // implementation of each rather than two that drift. None of them is
        // followed by a status write here: settlement claims the status
        // itself, and a write beside the claim can only disagree with it.
        const { status, ...rest } = validation.data;
        const plain: { notes?: string; status?: typeof status } = rest;

        if (status === "COMPLETED") {
            const settled = await settleOrder({
                kind: "order",
                reference: existing.id,
                provider: existing.paymentMethod || "manual",
                // The order's own total. A number from the request would let
                // a typo mark a 500 order paid at 5.
                providerRef: existing.paymentId || `manual:${existing.id}`,
                amount: Number(existing.total),
                currency: existing.currency,
            });
            if (!settled.handled) {
                log.error("Marking an order paid did not settle it", { id, error: settled.error });
                return NextResponse.json({ error: "That order could not be marked paid" }, { status: 500 });
            }
        } else if (status === "CANCELLED") {
            const voided = await voidOrder(existing.id);
            if (!voided.handled) {
                return NextResponse.json({ error: "That order could not be cancelled" }, { status: 500 });
            }
        } else if (status === "REFUNDED") {
            if (!existing.paymentId) {
                // Nothing was ever taken, so there is nothing to send back.
                // Cancelling is what they mean.
                return NextResponse.json(
                    { error: "That order has no payment to refund", code: "order_no_payment" },
                    { status: 400 },
                );
            }
            const refunded = await refundPayment(existing.paymentMethod || "manual", existing.paymentId);
            if (!refunded.handled) {
                return NextResponse.json({ error: "That order could not be refunded" }, { status: 500 });
            }
        } else if (status) {
            // PENDING and PROCESSING are notes an operator makes about where
            // an order stands. Nothing is granted or taken back.
            plain.status = status;
        }

        const order = await prisma.order.update({
            where: { id },
            data: plain,
            include: {
                items: true,
                user: {
                    select: { id: true, username: true, email: true },
                },
            },
        });

        return NextResponse.json({ order });
    } catch (error) {
        log.error("Update order error", { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
