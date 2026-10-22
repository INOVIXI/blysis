// @vitest-environment node
/**
 * A CoinPayments checkout settles only for the amount the store asked for.
 *
 * The hosted checkout is a link, and the amount and currency are query
 * parameters in it: the buyer's browser holds them and can change them. Edit
 * `amountf=49.99` to `amountf=0.01` and CoinPayments takes a cent, then sends
 * an IPN that is genuinely signed with this store's secret, because it is a
 * genuine payment of a cent. The route checked the signature and the merchant,
 * passed the cent on as the amount, and the store, which does not compare
 * amounts, granted the order.
 *
 * The link now carries a binding of the reference, the amount and the currency
 * under the IPN secret, which CoinPayments echoes back as `custom`. An IPN
 * whose amount or currency is not the one bound is refused.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

const SECRET = "ipn-secret";
const MERCHANT = "merchant-1";

vi.mock("@/core/sdk/server", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    readSettingStrings: async () => ({ coinpayments_merchant_id: MERCHANT, coinpayments_ipn_secret: SECRET }),
    resolveAppUrl: async () => "https://shop.example",
}));

const applyFiltersAsync = vi.fn(async () => ({ handled: true, duplicate: false, error: null }));
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: (...args: unknown[]) => applyFiltersAsync(...args) }));

const { default: onPaymentSession } = await import("@/modules/coinpayments-gateway/hooks/on-payment-session");
const { POST } = await import("@/modules/coinpayments-gateway/api/ipn/route");
const { NextRequest } = await import("next/server");

/** The link a buyer is sent to for an order of 49.99 USD. */
async function checkoutLink(): Promise<URLSearchParams> {
    const result = await onPaymentSession(
        { handled: false, redirectUrl: null, reference: null, error: null },
        {
            provider: "coinpayments",
            kind: "order",
            reference: "order-1",
            amount: 49.99,
            currency: "USD",
            description: "Order 1001",
            lines: [],
            successUrl: "https://shop.example/store/order-success",
            cancelUrl: "https://shop.example/store/cart",
            customer: { userId: "user-1", email: null, name: null },
            metadata: {},
        } as never,
    );
    expect(result.redirectUrl).toBeTruthy();
    return new URL(result.redirectUrl as string).searchParams;
}

/** What CoinPayments posts once a payment made from `link` completes, signed as CoinPayments signs it. */
function ipn(link: URLSearchParams, paid: { amount?: string; currency?: string } = {}) {
    const fields = new URLSearchParams({
        merchant: MERCHANT,
        status: "100",
        txn_id: "CP-TXN-1",
        item_number: link.get("item_number") ?? "",
        amount1: paid.amount ?? link.get("amountf") ?? "",
        currency1: paid.currency ?? link.get("currency") ?? "",
        custom: link.get("custom") ?? "",
    });
    const body = fields.toString();
    const hmac = crypto.createHmac("sha512", SECRET).update(body).digest("hex");
    return new NextRequest("https://shop.example/api/v1/coinpayments/ipn", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", hmac },
        body,
    });
}

beforeEach(() => {
    applyFiltersAsync.mockClear();
});

describe("a CoinPayments IPN", () => {
    it("settles a payment of the amount the link was made for", async () => {
        const res = await POST(ipn(await checkoutLink()));
        expect(res.status).toBe(200);
        expect(applyFiltersAsync).toHaveBeenCalledTimes(1);
        const [hook, , settlement] = applyFiltersAsync.mock.calls[0] as unknown as [string, unknown, Record<string, unknown>];
        expect(hook).toBe("payment.settled");
        expect(settlement).toMatchObject({ reference: "order-1", amount: 49.99, currency: "USD" });
    });

    it("settles nothing when the buyer paid less than the link asked for", async () => {
        const res = await POST(ipn(await checkoutLink(), { amount: "0.01" }));
        expect(res.status).toBe(400);
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });

    it("settles nothing when the buyer changed the currency", async () => {
        const res = await POST(ipn(await checkoutLink(), { currency: "TRY" }));
        expect(res.status).toBe(400);
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });

    it("settles nothing for a link whose binding was removed", async () => {
        const link = await checkoutLink();
        link.delete("custom");
        const res = await POST(ipn(link));
        expect(res.status).toBe(400);
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });

    it("settles nothing for a binding moved onto another order", async () => {
        const link = await checkoutLink();
        link.set("item_number", "order-2");
        const res = await POST(ipn(link));
        expect(res.status).toBe(400);
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });

    it("reads an amount CoinPayments writes with more decimals as the same amount", async () => {
        const res = await POST(ipn(await checkoutLink(), { amount: "49.99000000" }));
        expect(res.status).toBe(200);
        expect(applyFiltersAsync).toHaveBeenCalledTimes(1);
    });

    it("still refuses a body whose signature does not verify", async () => {
        const req = ipn(await checkoutLink());
        const forged = new NextRequest(req.url, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded", hmac: "0".repeat(128) },
            body: await req.text(),
        });
        const res = await POST(forged);
        expect(res.status).toBe(400);
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });
});
