// @vitest-environment node
/**
 * A Mercado Pago notification names a payment id, and the payment is read
 * back with the account's access token before anything is settled.
 *
 * When the account signs its webhooks, the x-signature header is checked
 * first: an HMAC over `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, which
 * is computed here from Mercado Pago's description rather than with the
 * module's own function, so a mistake in that function cannot pass its own
 * test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

const settings: Record<string, string | null> = { mercadopago_access_token: "APP_USR-1", mercadopago_webhook_secret: null };

vi.mock("@/core/sdk/server", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    readSettingStrings: async () => settings,
    readJsonBody: async (request: Request) => request.json(),
}));

const applyFiltersAsync = vi.fn(async () => ({ handled: true, duplicate: false, error: null }));
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: (...args: unknown[]) => applyFiltersAsync(...args) }));

const { POST } = await import("@/modules/mercadopago-gateway/api/webhook/route");
const { NextRequest } = await import("next/server");

const fetchMock = vi.fn();

function notification(headers: Record<string, string> = {}, id = "123456") {
    return new NextRequest("https://shop.example/api/v1/mercadopago/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ type: "payment", data: { id } }),
    });
}

function signed(secret: string, id = "123456", requestId = "req-1", ts = "1700000000") {
    const v1 = crypto.createHmac("sha256", secret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest("hex");
    return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId };
}

function mercadoPagoSays(payment: Record<string, unknown>, status = 200) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payment), { status }));
}

const approved = { id: 123456, status: "approved", external_reference: "order-1", transaction_amount: 1500, currency_id: "ARS" };

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
    settings.mercadopago_webhook_secret = null;
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("a Mercado Pago notification", () => {
    it("settles what Mercado Pago says about the payment it names", async () => {
        mercadoPagoSays(approved);

        const res = await POST(notification());

        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.mercadopago.com/v1/payments/123456",
            expect.objectContaining({ headers: { Authorization: "Bearer APP_USR-1" } }),
        );
        expect(settled()).toMatchObject({ reference: "order-1", providerRef: "123456", amount: 1500, currency: "ARS" });
    });

    it("settles nothing for a payment that is not approved", async () => {
        mercadoPagoSays({ ...approved, status: "in_process" });
        await POST(notification());
        expect(settled()).toBeUndefined();
    });

    it("asks Mercado Pago to try again when the lookup fails", async () => {
        mercadoPagoSays({ message: "not found" }, 404);
        const res = await POST(notification());
        expect(res.status).toBe(500);
        expect(settled()).toBeUndefined();
    });

    it("acknowledges and drops a notification about something other than a payment", async () => {
        const res = await POST(
            new NextRequest("https://shop.example/api/v1/mercadopago/webhook", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ type: "merchant_order", data: { id: "9" } }),
            }),
        );
        expect(res.status).toBe(200);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("a Mercado Pago notification on an account that signs them", () => {
    beforeEach(() => {
        settings.mercadopago_webhook_secret = "mp-secret";
    });

    it("is read back when its signature matches", async () => {
        mercadoPagoSays(approved);

        const res = await POST(notification(signed("mp-secret")));

        expect(res.status).toBe(200);
        expect(settled()).toMatchObject({ reference: "order-1" });
    });

    it("is refused, without a lookup, when it is signed with another secret", async () => {
        const res = await POST(notification(signed("not-the-secret")));

        expect(res.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("is refused when the signature was made for another payment", async () => {
        const res = await POST(notification(signed("mp-secret", "999")));

        expect(res.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("is refused when it carries no signature at all", async () => {
        const res = await POST(notification());

        expect(res.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
