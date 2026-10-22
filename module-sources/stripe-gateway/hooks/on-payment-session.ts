/**
 * Starts a Stripe Checkout session for whatever the store is selling.
 *
 * The store hands over an amount, some lines and a reference; what comes back
 * is a URL to send the buyer to. Nothing is granted here, and no order is
 * touched: this module reports back through `payment.settled` once Stripe says
 * the money moved.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma, log } from "@/core/sdk/server";
import { getStripe, getStripeEnabled } from "../lib/stripe";
import { toStripeAmount } from "../lib/minor-units";

/** Everything Stripe is told about a payment, in the shape it wants. */
function baseParams(request: PaymentSessionRequest): Record<string, unknown> {
    return {
        payment_method_types: ["card"],
        metadata: { ...request.metadata, reference: request.reference, kind: request.kind },
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
    };
}

async function customerFor(request: PaymentSessionRequest): Promise<string | undefined> {
    const userId = request.customer.userId;
    if (!userId) return undefined;

    const known = await prisma.stripeCustomer.findUnique({ where: { userId } });
    if (known) return known.customerId;

    const customer = await (await getStripe()).customers.create({
        email: request.customer.email ?? undefined,
        name: request.customer.name ?? undefined,
        metadata: { userId },
    });
    await prisma.stripeCustomer.create({ data: { userId, customerId: customer.id } });
    return customer.id;
}

/**
 * Stripe wants a Price object for a recurring plan, and reuses it across
 * subscribers. The signature is what the price was created from, so a product
 * whose price or interval changed gets a new one rather than quietly charging
 * the old amount forever.
 */
async function priceFor(
    request: PaymentSessionRequest,
    recurring: NonNullable<PaymentSessionRequest["recurring"]>,
): Promise<string> {
    const signature = `${request.amount}:${request.currency}:${recurring.interval}:${recurring.intervalCount}`;
    const known = await prisma.stripePrice.findUnique({ where: { productId: recurring.productId } });
    if (known && known.signature === signature) return known.priceId;

    const price = await (await getStripe()).prices.create({
        unit_amount: toStripeAmount(request.amount, request.currency),
        currency: request.currency.toLowerCase(),
        recurring: { interval: recurring.interval, interval_count: recurring.intervalCount },
        product_data: { name: request.description },
    });

    await prisma.stripePrice.upsert({
        where: { productId: recurring.productId },
        create: { productId: recurring.productId, priceId: price.id, signature },
        update: { priceId: price.id, signature },
    });
    return price.id;
}

/** Stripe rejects a negative line, so a discount travels as a one-off coupon. */
async function discountParams(request: PaymentSessionRequest): Promise<Record<string, unknown>> {
    const discount = Number(request.metadata.discount ?? 0);
    if (!(discount > 0)) return {};
    const coupon = await (await getStripe()).coupons.create({
        amount_off: toStripeAmount(discount, request.currency),
        currency: request.currency.toLowerCase(),
        duration: "once",
    });
    return { discounts: [{ coupon: coupon.id }] };
}

const onPaymentSession: HookHandlerFor<"payment.session", "filter"> = async (result, request) => {
    if (result.handled || request.provider !== "stripe") return result;
    if (!(await getStripeEnabled())) return result;

    try {
        const stripe = await getStripe();
        const params: Record<string, unknown> = { ...baseParams(request), ...(await discountParams(request)) };

        if (request.recurring) {
            params.mode = "subscription";
            params.customer = await customerFor(request);
            params.line_items = [{ price: await priceFor(request, request.recurring), quantity: 1 }];
            params.subscription_data = {
                metadata: {
                    ...request.metadata,
                    reference: request.reference,
                    productId: request.recurring.productId,
                },
            };
        } else {
            params.mode = "payment";
            params.line_items = request.lines.map((line) => ({
                price_data: {
                    currency: request.currency.toLowerCase(),
                    product_data: { name: line.name },
                    unit_amount: toStripeAmount(line.unitAmount, request.currency),
                },
                quantity: line.quantity,
            }));
        }

        const session = await stripe.checkout.sessions.create(
            params as Parameters<typeof stripe.checkout.sessions.create>[0],
        );

        return { handled: true, redirectUrl: session.url, reference: session.id, error: null };
    } catch (error) {
        log.error("[stripe-gateway] could not start a checkout session", {
            reference: request.reference,
            error: error instanceof Error ? error.message : String(error),
        });
        // Handled, but failed: the store tells the buyer to try again rather
        // than telling them the site takes no cards.
        return {
            handled: true,
            redirectUrl: null,
            reference: null,
            error: "The card payment could not be started. Try again shortly.",
        };
    }
};

export default onPaymentSession;
