// @vitest-environment node
/**
 * The buyer coming back from PayPal is what captures the money, once.
 *
 * PayPal has no webhook in this flow: the return URL carries PayPal's order
 * token, the route captures it with the site's credentials and reports the
 * capture. Everything else - what the payment was for, where to send the
 * buyer - was written to a row when it started, because a URL the buyer can
 * edit can point anywhere. A reloaded return URL must not capture twice, and
 * a capture nothing recorded must not be marked complete.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const paypalPayment = { findUnique: vi.fn(), update: vi.fn(async () => ({})) };

vi.mock("@/core/sdk/server", () => ({
    prisma: { paypalPayment },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    resolveAppUrl: async () => "https://shop.example",
    readSettingStrings: async () => ({ paypal_client_id: "client", paypal_client_secret: "secret", paypal_mode: "sandbox" }),
}));

const applyFiltersAsync = vi.fn(async () => ({ handled: true, duplicate: false, error: null }));
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: (...args: unknown[]) => applyFiltersAsync(...args) }));

const { GET } = await import("@/modules/paypal-gateway/api/capture/route");
const { NextRequest } = await import("next/server");

const fetchMock = vi.fn();

const pending = {
    id: "row-1",
    paypalOrderId: "PAYPAL-ORDER-1",
    reference: "order-1",
    kind: "order",
    amount: 49.99,
    currency: "USD",
    successUrl: "https://shop.example/store/order-success",
    cancelUrl: "https://shop.example/store/cart",
    metadata: { orderNumber: "1001" },
    status: "PENDING",
};

function returnFromPaypal(token: string | null = "PAYPAL-ORDER-1") {
    const query = token ? `?token=${token}&PayerID=PAYER` : "";
    return new NextRequest(`https://shop.example/api/v1/paypal/capture${query}`);
}

/** PayPal handing out a token, then answering the capture. */
function paypalCaptures(capture: Record<string, unknown>) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "A21" })));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(capture)));
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
    paypalPayment.findUnique.mockReset();
    paypalPayment.update.mockClear();
    applyFiltersAsync.mockClear();
    applyFiltersAsync.mockResolvedValue({ handled: true, duplicate: false, error: null });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("coming back from PayPal", () => {
    it("captures, reports what PayPal captured, and marks the payment complete", async () => {
        paypalPayment.findUnique.mockResolvedValueOnce(pending);
        paypalCaptures({
            status: "COMPLETED",
            purchase_units: [{ payments: { captures: [{ amount: { value: "49.99", currency_code: "USD" } }] } }],
        });

        const res = await GET(returnFromPaypal());

        expect(fetchMock.mock.calls[1][0]).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders/PAYPAL-ORDER-1/capture");
        expect(settled()).toMatchObject({
            kind: "order",
            reference: "order-1",
            providerRef: "PAYPAL-ORDER-1",
            amount: 49.99,
            currency: "USD",
            metadata: { orderNumber: "1001" },
        });
        expect(paypalPayment.update).toHaveBeenCalledWith({ where: { id: "row-1" }, data: { status: "COMPLETED" } });
        expect(res.headers.get("location")).toBe("https://shop.example/store/order-success");
    });

    it("does not capture again when the return URL is reloaded", async () => {
        paypalPayment.findUnique.mockResolvedValueOnce({ ...pending, status: "COMPLETED" });

        const res = await GET(returnFromPaypal());

        expect(fetchMock).not.toHaveBeenCalled();
        expect(settled()).toBeUndefined();
        expect(res.headers.get("location")).toBe("https://shop.example/store/order-success");
    });

    // The store holds a settlement against what it charged. Reporting what
    // was asked when PayPal reports nothing would be the gateway vouching for
    // itself.
    it("reports no amount of its own when PayPal's capture carries none", async () => {
        paypalPayment.findUnique.mockResolvedValueOnce(pending);
        paypalCaptures({ status: "COMPLETED", purchase_units: [] });

        await GET(returnFromPaypal());

        expect(settled()).toMatchObject({ amount: null });
    });

    it("settles nothing when PayPal did not complete the capture", async () => {
        paypalPayment.findUnique.mockResolvedValueOnce(pending);
        paypalCaptures({ status: "PAYER_ACTION_REQUIRED" });

        const res = await GET(returnFromPaypal());

        expect(settled()).toBeUndefined();
        expect(res.headers.get("location")).toBe("https://shop.example/store/cart?error=payment_failed");
    });

    it("does not mark a capture complete that nothing recorded", async () => {
        paypalPayment.findUnique.mockResolvedValueOnce(pending);
        applyFiltersAsync.mockResolvedValueOnce({ handled: false, duplicate: false, error: "settlement failed" });
        paypalCaptures({
            status: "COMPLETED",
            purchase_units: [{ payments: { captures: [{ amount: { value: "49.99", currency_code: "USD" } }] } }],
        });

        const res = await GET(returnFromPaypal());

        expect(paypalPayment.update).not.toHaveBeenCalled();
        expect(res.headers.get("location")).toBe("https://shop.example/store/cart?error=capture_failed");
    });

    it("captures nothing for a token no payment was started with", async () => {
        paypalPayment.findUnique.mockResolvedValueOnce(null);

        const res = await GET(returnFromPaypal("SOMEONE-ELSES"));

        expect(fetchMock).not.toHaveBeenCalled();
        expect(res.headers.get("location")).toBe("https://shop.example/store/cart?error=invalid_order");
    });
});
