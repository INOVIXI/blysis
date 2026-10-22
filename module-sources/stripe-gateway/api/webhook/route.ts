/**
 * What Stripe tells us after the buyer leaves.
 *
 * This module does not grant anything or touch an order. It verifies the
 * signature, translates the event into the payment contract, and passes it on.
 * Whoever answers decides what a paid order means; if nobody does, the webhook
 * fails so Stripe retries rather than dropping a payment on the floor.
 */
import { NextRequest, NextResponse } from "next/server";
import { applyFiltersAsync } from "@/core/sdk";
import { log } from "@/core/sdk/server";
import Stripe from "stripe";
import { getStripe, getStripeWebhookSecret } from "../../lib/stripe";
import { fromStripeAmount } from "../../lib/minor-units";

export const dynamic = "force-dynamic";

const UNHANDLED: PaymentOutcome = { handled: false, duplicate: false, error: null };

/** 500 makes Stripe retry; 200 tells it we are done with the event. */
function reply(outcome: PaymentOutcome): NextResponse {
    if (outcome.handled) return NextResponse.json({ received: true });
    log.error("[stripe-gateway] nothing handled a Stripe event", { error: outcome.error });
    return NextResponse.json({ error: outcome.error ?? "unhandled" }, { status: 500 });
}

export async function POST(request: NextRequest) {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");
    if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

    let event: Stripe.Event;
    try {
        const stripe = await getStripe();
        event = stripe.webhooks.constructEvent(body, signature, (await getStripeWebhookSecret()) || "");
    } catch (err) {
        log.error("[stripe-gateway] webhook signature verification failed", { error: String(err) });
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            // A subscription checkout is reported by its own events; paying
            // for it here as well would grant the product twice.
            if (session.mode === "subscription") return NextResponse.json({ received: true });

            const reference = session.metadata?.reference ?? session.metadata?.orderId;
            if (!reference) return NextResponse.json({ received: true });

            return reply(
                await applyFiltersAsync("payment.settled", UNHANDLED, {
                    kind: session.metadata?.type === "credit_purchase" ? "credits" : "order",
                    reference,
                    provider: "stripe",
                    providerRef: (session.payment_intent as string) ?? session.id,
                    amount: fromStripeAmount(session.amount_total ?? 0, session.currency ?? "usd"),
                    currency: session.currency ?? "usd",
                    metadata: (session.metadata ?? {}) as Record<string, string>,
                }),
            );
        }

        case "checkout.session.expired": {
            const session = event.data.object as Stripe.Checkout.Session;
            const reference = session.metadata?.reference ?? session.metadata?.orderId;
            if (!reference) return NextResponse.json({ received: true });
            return reply(
                await applyFiltersAsync("payment.voided", UNHANDLED, {
                    kind: session.metadata?.type === "credit_purchase" ? "credits" : "order",
                    reference,
                    provider: "stripe",
                }),
            );
        }

        case "charge.refunded": {
            const charge = event.data.object as Stripe.Charge;
            const paymentIntentId = charge.payment_intent as string | null;
            if (!paymentIntentId) return NextResponse.json({ received: true });
            return reply(
                await applyFiltersAsync("payment.refunded", UNHANDLED, {
                    provider: "stripe",
                    providerRef: paymentIntentId,
                    amount: fromStripeAmount(charge.amount_refunded ?? 0, charge.currency),
                }),
            );
        }

        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
            const sub = event.data.object as Stripe.Subscription;
            const userId = sub.metadata?.userId;
            const productId = sub.metadata?.productId;
            if (!userId || !productId) return NextResponse.json({ received: true });

            // `current_period_end` is a top-level field Stripe's own types do
            // not expose on the Subscription object in this SDK version.
            const periodEnd = (sub as unknown as Record<string, number | undefined>).current_period_end;

            return reply(
                await applyFiltersAsync("subscription.changed", UNHANDLED, {
                    provider: "stripe",
                    providerRef: sub.id,
                    userId,
                    productId,
                    status: event.type === "customer.subscription.deleted" ? "canceled" : sub.status,
                    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
                    ended: event.type === "customer.subscription.deleted",
                }),
            );
        }
    }

    return NextResponse.json({ received: true });
}
