// @vitest-environment node
/**
 * Mollie's webhook carries a payment id and nothing else, so everything a
 * settlement says is read back from Mollie with the site's own key.
 *
 * Anybody can post an id to the webhook. What protects the store is that the
 * route believes only Mollie's answer about it: the status, the amount, the
 * currency and the reference all come from that lookup, and a lookup that
 * fails is a failure Mollie is asked to retry rather than a payment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/core/sdk/server", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    readSettingStrings: async () => ({ mollie_api_key: "test_key" }),
    resolveAppUrl: async () => "https://shop.example",
}));

const applyFiltersAsync = vi.fn(async () => ({ handled: true, duplicate: false, error: null }));
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: (...args: unknown[]) => applyFiltersAsync(...args) }));

const { POST } = await import("@/modules/mollie-gateway/api/webhook/route");
const { default: onPaymentSession } = await import("@/modules/mollie-gateway/hooks/on-payment-session");
const { NextRequest } = await import("next/server");

const fetchMock = vi.fn();

function webhook(id: string) {
    return new NextRequest("https://shop.example/api/v1/mollie/webhook", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ id }).toString(),
    });
}

/** Mollie answering a lookup for `tr_1`. */
function mollieSays(payment: Record<string, unknown>, status = 200) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payment), { status }));
}

function settled() {
    const call = applyFiltersAsync.mock.calls.find((c) => (c as unknown[])[0] === "payment.settled") as unknown as
        | [string, unknown, Record<string, unknown>]
        | undefined;
    return call?.[2];
}

beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    applyFiltersAsync.mockClear();
    applyFiltersAsync.mockResolvedValue({ handled: true, duplicate: false, error: null });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("the Mollie webhook", () => {
    it("settles with what Mollie says, looked up with the site's key", async () => {
        mollieSays({
            id: "tr_1",
            status: "paid",
            amount: { value: "42.50", currency: "EUR" },
            metadata: { reference: "order-1", kind: "order" },
        });

        const res = await POST(webhook("tr_1"));

        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.mollie.com/v2/payments/tr_1",
            expect.objectContaining({ headers: { Authorization: "Bearer test_key" } }),
        );
        expect(settled()).toMatchObject({ reference: "order-1", providerRef: "tr_1", amount: 42.5, currency: "EUR" });
    });

    it("settles nothing for a payment Mollie says is still open", async () => {
        mollieSays({ id: "tr_1", status: "open", amount: { value: "42.50", currency: "EUR" }, metadata: { reference: "order-1" } });

        await POST(webhook("tr_1"));

        expect(settled()).toBeUndefined();
    });

    it("refuses an id that is not a Mollie payment id without asking Mollie", async () => {
        const res = await POST(webhook("order-1"));

        expect(res.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("asks Mollie to try again when the lookup fails", async () => {
        mollieSays({ detail: "Not found" }, 404);

        const res = await POST(webhook("tr_1"));

        expect(res.status).toBe(500);
        expect(settled()).toBeUndefined();
    });

    it("asks Mollie to try again when nothing recorded a paid payment", async () => {
        applyFiltersAsync.mockResolvedValueOnce({ handled: false, duplicate: false, error: "settlement failed" });
        mollieSays({ id: "tr_1", status: "paid", amount: { value: "42.50", currency: "EUR" }, metadata: { reference: "order-1" } });

        const res = await POST(webhook("tr_1"));

        expect(res.status).toBe(500);
    });

    it("reports a refund rather than a second settlement", async () => {
        mollieSays({
            id: "tr_1",
            status: "paid",
            amount: { value: "42.50", currency: "EUR" },
            amountRefunded: { value: "42.50", currency: "EUR" },
            metadata: { reference: "order-1" },
        });

        await POST(webhook("tr_1"));

        expect(settled()).toBeUndefined();
        expect(applyFiltersAsync).toHaveBeenCalledWith(
            "payment.refunded",
            expect.anything(),
            expect.objectContaining({ providerRef: "tr_1", amount: 42.5 }),
        );
    });
});

describe("a Mollie payment being started", () => {
    async function start(amount: number, currency: string) {
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({ id: "tr_1", _links: { checkout: { href: "https://mollie.test/pay" } } }), {
                status: 201,
            }),
        );
        await onPaymentSession(
            { handled: false, redirectUrl: null, reference: null, error: null },
            {
                provider: "mollie",
                kind: "order",
                reference: "order-1",
                amount,
                currency,
                description: "Order 1001",
                lines: [],
                successUrl: "https://shop.example/store/order-success",
                cancelUrl: "https://shop.example/store/cart",
                customer: { userId: null, email: null, name: null },
                metadata: {},
            } as never,
        );
        const init = fetchMock.mock.calls[0][1] as { body: string };
        return JSON.parse(init.body) as { amount: { value: string; currency: string } };
    }

    it("writes the amount with two decimals, as Mollie insists", async () => {
        expect((await start(42.5, "EUR")).amount).toEqual({ value: "42.50", currency: "EUR" });
    });

    // Mollie lists the yen with no decimal places
    // (https://docs.mollie.com/docs/multicurrency), and the amount is written
    // the way its currency is.
    it("writes no decimals for the yen", async () => {
        expect((await start(1000, "JPY")).amount).toEqual({ value: "1000", currency: "JPY" });
    });
});
