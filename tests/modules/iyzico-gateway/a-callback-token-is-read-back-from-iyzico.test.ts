// @vitest-environment node
/**
 * iyzico's callback posts an opaque token, and the payment is read back from
 * iyzico with the site's key before anything is settled.
 *
 * The buyer's browser makes the post, so a forged one proves nothing: the
 * basket, the paid price and the status all come from iyzico's answer. The
 * lookup is signed the way iyzico describes, an HMAC over the random key, the
 * path and the body in that order, recomputed here from that description.
 * Where the buyer goes afterwards came back through the browser too, so only
 * a path on this site is accepted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

vi.mock("@/core/sdk/server", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    readSettingStrings: async () => ({ iyzico_api_key: "api-key", iyzico_secret_key: "secret-key", iyzico_sandbox: "true" }),
    resolveAppUrl: async () => "https://shop.example",
}));

const applyFiltersAsync = vi.fn(async () => ({ handled: true, duplicate: false, error: null }));
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: (...args: unknown[]) => applyFiltersAsync(...args) }));

const { POST } = await import("@/modules/iyzico-gateway/api/callback/route");
const { NextRequest } = await import("next/server");

const fetchMock = vi.fn();
const DETAIL = "/payment/iyzipos/checkoutform/auth/ecom/detail";

function callback(query = "?to=%2Fstore%2Forder-success&cancel=%2Fstore%2Fcart", token = "tok_1") {
    return new NextRequest(`https://shop.example/api/v1/iyzico/callback${query}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
    });
}

function iyzicoSays(detail: Record<string, unknown>) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(detail)));
}

const paid = { status: "success", paymentStatus: "SUCCESS", paymentId: "pid-1", basketId: "order-1", paidPrice: "499.90", currency: "TRY" };

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

describe("an iyzico callback", () => {
    it("reads the token back from iyzico, signed as iyzico describes", async () => {
        iyzicoSays(paid);

        await POST(callback());

        const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
        expect(url).toBe(`https://sandbox-api.iyzipay.com${DETAIL}`);
        expect(JSON.parse(init.body)).toMatchObject({ token: "tok_1" });
        const randomKey = init.headers["x-iyzi-rnd"];
        const signature = crypto.createHmac("sha256", "secret-key").update(randomKey + DETAIL + init.body).digest("hex");
        const expected = Buffer.from(`apiKey:api-key&randomKey:${randomKey}&signature:${signature}`).toString("base64");
        expect(init.headers.Authorization).toBe(`IYZWSv2 ${expected}`);
    });

    it("settles the basket iyzico names, for the price iyzico says was paid", async () => {
        iyzicoSays(paid);

        const res = await POST(callback());

        expect(settled()).toMatchObject({ reference: "order-1", providerRef: "pid-1", amount: 499.9, currency: "TRY" });
        expect(res.headers.get("location")).toBe("https://shop.example/store/order-success");
    });

    it("settles nothing for a payment iyzico does not call a success", async () => {
        iyzicoSays({ ...paid, paymentStatus: "FAILURE" });

        const res = await POST(callback());

        expect(settled()).toBeUndefined();
        expect(res.headers.get("location")).toBe("https://shop.example/store/cart?error=payment_failed");
    });

    it("settles nothing for a token iyzico does not know", async () => {
        iyzicoSays({ status: "failure", errorMessage: "Invalid token" });

        await POST(callback());

        expect(settled()).toBeUndefined();
    });

    it("sends the buyer nowhere but this site, whatever came back in the query", async () => {
        iyzicoSays(paid);

        const res = await POST(callback("?to=%2F%2Fevil.example&cancel=https%3A%2F%2Fevil.example"));

        expect(res.headers.get("location")).toBe("https://shop.example/store/order-success");
    });

    it("does not tell the buyer it worked when nothing recorded the payment", async () => {
        applyFiltersAsync.mockResolvedValueOnce({ handled: false, duplicate: false, error: "settlement failed" });
        iyzicoSays(paid);

        const res = await POST(callback());

        expect(res.headers.get("location")).toBe("https://shop.example/store/cart?error=settlement_failed");
    });
});
