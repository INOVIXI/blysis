// @vitest-environment node
/**
 * Stripe is asked for an amount in the currency's own smallest unit.
 *
 * Stripe takes integers, and the smallest unit is not always a hundredth: a
 * yen has no cents, and a Kuwaiti dinar has a thousand fils. Every amount was
 * multiplied by a hundred, so a shop pricing in yen charged its buyers a
 * hundred times the price on the page, and the webhook divided by a hundred
 * on the way back, so the order looked paid for exactly what it cost.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" }));
vi.mock("@/modules/stripe-gateway/lib/stripe", () => ({
    getStripe: async () => ({ checkout: { sessions: { create } } }),
    getStripeEnabled: async () => true,
}));
vi.mock("@/core/sdk/server", () => ({
    prisma: {},
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { toStripeAmount, fromStripeAmount } = await import("@/modules/stripe-gateway/lib/minor-units");
const { default: onPaymentSession } = await import("@/modules/stripe-gateway/hooks/on-payment-session");

beforeEach(() => {
    create.mockClear();
});

describe("an amount Stripe is asked for", () => {
    it("is in cents for a currency that has them", () => {
        expect(toStripeAmount(42.5, "USD")).toBe(4250);
        expect(fromStripeAmount(4250, "usd")).toBe(42.5);
    });

    it("is the amount itself for a currency with no minor unit", () => {
        expect(toStripeAmount(1000, "JPY")).toBe(1000);
        expect(toStripeAmount(15000, "krw")).toBe(15000);
        expect(fromStripeAmount(1000, "jpy")).toBe(1000);
    });

    // Stripe takes three-decimal currencies in thousandths, and only when
    // the last digit is zero.
    it("is in thousandths, ending in a zero, for a three-decimal currency", () => {
        expect(toStripeAmount(12.34, "KWD")).toBe(12340);
        expect(toStripeAmount(1.005, "BHD") % 10).toBe(0);
        expect(fromStripeAmount(12340, "kwd")).toBe(12.34);
    });

    it("rounds a float rather than truncating it", () => {
        expect(toStripeAmount(19.99, "EUR")).toBe(1999);
        expect(toStripeAmount(1000.4, "JPY")).toBe(1000);
    });
});

describe("a Stripe checkout for a shop in yen", () => {
    it("charges the price on the page", async () => {
        await onPaymentSession(
            { handled: false, redirectUrl: null, reference: null, error: null },
            {
                provider: "stripe",
                kind: "order",
                reference: "order-1",
                amount: 1000,
                currency: "JPY",
                description: "Order 1001",
                lines: [{ name: "VIP", quantity: 1, unitAmount: 1000 }],
                successUrl: "https://shop.example/store/order-success",
                cancelUrl: "https://shop.example/store/cart",
                customer: { userId: null, email: null, name: null },
                metadata: {},
            } as never,
        );

        const params = (create.mock.calls[0] as unknown as [{ line_items: { price_data: { unit_amount: number } }[] }])[0];
        expect(params.line_items[0].price_data.unit_amount).toBe(1000);
    });
});
