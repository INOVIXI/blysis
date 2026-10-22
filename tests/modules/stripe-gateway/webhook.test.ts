// @vitest-environment node
/**
 * What the Stripe webhook is now responsible for.
 *
 * Since payments became a contract, this route grants nothing and touches no
 * order. Its whole job is: verify the signature, turn a Stripe event into the
 * shape `hooks.d.ts` publishes, and pass on whether anybody handled it. So the
 * tests mock the filter bus and assert on what was asked, not on what changed
 * in the database - the settling itself is tested in the store.
 *
 * The one behaviour worth more than a translation check is the answer code: a
 * webhook nobody handled must fail, or Stripe stops retrying and a paid order
 * stays PENDING forever.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const constructEvent = vi.fn();
vi.mock("@/modules/stripe-gateway/lib/stripe", () => ({
    getStripe: async () => ({ webhooks: { constructEvent } }),
    getStripeWebhookSecret: async () => "whsec_test",
}));

const applyFiltersAsync = vi.fn(async () => ({ handled: true, duplicate: false, error: null }));
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: (...args: unknown[]) => applyFiltersAsync(...args) }));
vi.mock("@/core/sdk/server", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const { POST } = await import("@/modules/stripe-gateway/api/webhook/route");
const { NextRequest } = await import("next/server");

function makeReq(opts: { signature?: string | null } = {}) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.signature !== null) headers["stripe-signature"] = opts.signature ?? "sig_test";
    return new NextRequest("http://example.com/api/v1/webhooks/stripe", {
        method: "POST",
        headers,
        body: "{}",
    });
}

/** The (name, value, context) triple the route pushed through the bus. */
function asked(index = 0) {
    const call = applyFiltersAsync.mock.calls[index] as unknown as [string, unknown, Record<string, unknown>];
    return { hook: call[0], context: call[2] };
}

beforeEach(() => {
    vi.clearAllMocks();
    applyFiltersAsync.mockResolvedValue({ handled: true, duplicate: false, error: null });
});

describe("signature gate", () => {
    it("refuses a request with no stripe-signature header", async () => {
        const res = await POST(makeReq({ signature: null }));
        expect(res.status).toBe(400);
        expect(constructEvent).not.toHaveBeenCalled();
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });

    it("refuses a body whose signature does not verify", async () => {
        constructEvent.mockImplementation(() => {
            throw new Error("No signatures found matching the expected signature");
        });
        const res = await POST(makeReq());
        expect(res.status).toBe(400);
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });
});

describe("checkout.session.completed", () => {
    const session = (overrides: Record<string, unknown> = {}) => ({
        type: "checkout.session.completed",
        data: {
            object: {
                id: "cs_1",
                payment_intent: "pi_123",
                amount_total: 4200,
                currency: "usd",
                metadata: { orderId: "order-1", playerName: "Steve" },
                ...overrides,
            },
        },
    });

    it("reports the payment in major units, with the order as its reference", async () => {
        constructEvent.mockReturnValue(session());
        const res = await POST(makeReq());

        expect(res.status).toBe(200);
        expect(asked().hook).toBe("payment.settled");
        expect(asked().context).toMatchObject({
            kind: "order",
            reference: "order-1",
            provider: "stripe",
            providerRef: "pi_123",
            amount: 42,
            currency: "usd",
        });
    });

    it("marks a wallet top-up as credits so the store does not look for an order", async () => {
        constructEvent.mockReturnValue(
            session({ metadata: { type: "credit_purchase", reference: "user-1", userId: "user-1", creditAmount: "25" } }),
        );
        await POST(makeReq());
        expect(asked().context).toMatchObject({ kind: "credits", reference: "user-1" });
    });

    // The subscription events carry the plan; settling here as well would
    // grant the product a second time.
    it("leaves a subscription checkout to the subscription events", async () => {
        constructEvent.mockReturnValue(session({ mode: "subscription" }));
        const res = await POST(makeReq());
        expect(res.status).toBe(200);
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });

    it("ignores a session that carries no reference of ours", async () => {
        constructEvent.mockReturnValue(session({ metadata: {} }));
        const res = await POST(makeReq());
        expect(res.status).toBe(200);
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });

    it("fails the webhook when nobody settled the payment, so Stripe retries", async () => {
        applyFiltersAsync.mockResolvedValue({ handled: false, duplicate: false, error: null });
        constructEvent.mockReturnValue(session());
        const res = await POST(makeReq());
        expect(res.status).toBe(500);
    });

    // A duplicate is handled - the store recognised it and did nothing. Failing
    // it would make Stripe retry an event that is already settled.
    it("accepts a replay the store recognised as a duplicate", async () => {
        applyFiltersAsync.mockResolvedValue({ handled: true, duplicate: true, error: null });
        constructEvent.mockReturnValue(session());
        const res = await POST(makeReq());
        expect(res.status).toBe(200);
    });
});

describe("the other events", () => {
    it("turns an expired session into a void", async () => {
        constructEvent.mockReturnValue({
            type: "checkout.session.expired",
            data: { object: { id: "cs_2", metadata: { orderId: "order-2" } } },
        });
        await POST(makeReq());
        expect(asked().hook).toBe("payment.voided");
        expect(asked().context).toMatchObject({ kind: "order", reference: "order-2", provider: "stripe" });
    });

    it("reports a refund against the payment intent, not the charge", async () => {
        constructEvent.mockReturnValue({
            type: "charge.refunded",
            data: { object: { id: "ch_1", payment_intent: "pi_123", amount_refunded: 4200, currency: "usd" } },
        });
        await POST(makeReq());
        expect(asked().hook).toBe("payment.refunded");
        expect(asked().context).toMatchObject({ provider: "stripe", providerRef: "pi_123", amount: 42 });
    });

    it("passes a subscription renewal on with the period it paid for", async () => {
        constructEvent.mockReturnValue({
            type: "customer.subscription.updated",
            data: {
                object: {
                    id: "sub_1",
                    status: "active",
                    current_period_end: 1_800_000_000,
                    metadata: { userId: "user-1", productId: "prod-1" },
                },
            },
        });
        await POST(makeReq());
        expect(asked().hook).toBe("subscription.changed");
        expect(asked().context).toMatchObject({
            provider: "stripe",
            providerRef: "sub_1",
            userId: "user-1",
            productId: "prod-1",
            status: "active",
            ended: false,
            currentPeriodEnd: new Date(1_800_000_000 * 1000).toISOString(),
        });
    });

    it("reports a deleted subscription as ended and cancelled", async () => {
        constructEvent.mockReturnValue({
            type: "customer.subscription.deleted",
            data: { object: { id: "sub_1", status: "active", metadata: { userId: "u", productId: "p" } } },
        });
        await POST(makeReq());
        expect(asked().context).toMatchObject({ status: "canceled", ended: true });
    });

    it("acknowledges an event it has nothing to say about", async () => {
        constructEvent.mockReturnValue({ type: "invoice.paid", data: { object: {} } });
        const res = await POST(makeReq());
        expect(res.status).toBe(200);
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });
});
