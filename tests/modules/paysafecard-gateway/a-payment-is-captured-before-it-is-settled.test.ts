// @vitest-environment node
/**
 * paysafecard's notification is a payment id, and settling it takes two
 * answers from paysafecard itself.
 *
 * The buyer authorises a payment and the merchant has to capture it; money
 * authorised and never captured goes back to the buyer a few days later. So
 * the route reads the payment back with the site's key, captures it when it is
 * only authorised, and settles only on a capture paysafecard reports as
 * SUCCESS. Nothing in the request is believed but the id.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/core/sdk/server", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    readSettingStrings: async () => ({ paysafecard_api_key: "psc_key", paysafecard_test_mode: "true" }),
}));

const applyFiltersAsync = vi.fn(async () => ({ handled: true, duplicate: false, error: null }));
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: (...args: unknown[]) => applyFiltersAsync(...args) }));

const { POST } = await import("@/modules/paysafecard-gateway/api/notify/route");
const { NextRequest } = await import("next/server");

const fetchMock = vi.fn();
const TEST_API = "https://apitest.paysafecard.com/v1";

function notify(paymentId = "pay_1") {
    return new NextRequest(`https://shop.example/api/v1/paysafecard/notify?payment_id=${paymentId}`, { method: "POST" });
}

function paysafecardSays(payment: Record<string, unknown>, status = 200) {
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

describe("a paysafecard notification", () => {
    it("captures an authorised payment, then settles what the capture reports", async () => {
        paysafecardSays({ id: "pay_1", status: "AUTHORIZED", correlation_id: "order-1", amount: 25, currency: "EUR" });
        paysafecardSays({ id: "pay_1", status: "SUCCESS", correlation_id: "order-1", amount: 25, currency: "EUR" });

        const res = await POST(notify());

        expect(res.status).toBe(200);
        expect(fetchMock.mock.calls[0][0]).toBe(`${TEST_API}/payments/pay_1`);
        expect(fetchMock.mock.calls[1][0]).toBe(`${TEST_API}/payments/pay_1/capture`);
        expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
        expect(settled()).toMatchObject({ reference: "order-1", providerRef: "pay_1", amount: 25, currency: "EUR" });
    });

    it("settles a payment already captured without capturing it again", async () => {
        paysafecardSays({ id: "pay_1", status: "SUCCESS", correlation_id: "order-1", amount: 25, currency: "EUR" });

        await POST(notify());

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(settled()).toMatchObject({ reference: "order-1" });
    });

    it("settles nothing when the capture did not succeed", async () => {
        paysafecardSays({ id: "pay_1", status: "AUTHORIZED", correlation_id: "order-1", amount: 25, currency: "EUR" });
        paysafecardSays({ id: "pay_1", status: "FAILED", correlation_id: "order-1" });

        await POST(notify());

        expect(settled()).toBeUndefined();
    });

    it("settles nothing for a payment still waiting on the buyer", async () => {
        paysafecardSays({ id: "pay_1", status: "INITIATED", correlation_id: "order-1", amount: 25, currency: "EUR" });

        await POST(notify());

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(settled()).toBeUndefined();
    });

    it("cancels the order for a payment the buyer abandoned", async () => {
        paysafecardSays({ id: "pay_1", status: "CANCELLED_CUSTOMER", correlation_id: "order-1" });

        await POST(notify());

        expect(applyFiltersAsync).toHaveBeenCalledWith(
            "payment.voided",
            expect.anything(),
            expect.objectContaining({ reference: "order-1", provider: "paysafecard" }),
        );
    });

    it("asks paysafecard to try again when the lookup fails", async () => {
        paysafecardSays({ message: "unavailable" }, 503);

        const res = await POST(notify());

        expect(res.status).toBe(500);
        expect(settled()).toBeUndefined();
    });

    it("refuses a notification with no payment id", async () => {
        const res = await POST(new NextRequest("https://shop.example/api/v1/paysafecard/notify", { method: "POST" }));
        expect(res.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
