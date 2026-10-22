// @vitest-environment node
/**
 * Only a webhook signed with the account's webhook secret settles anything.
 *
 * The buyer is redirected back the moment a payment link is paid, and that
 * redirect proves nothing. Razorpay's webhook is the report, and its
 * signature is an HMAC over the exact bytes it sent: a body changed after
 * signing, or signed with another secret, is refused before it is read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

const SECRET = "whsec_razorpay";

vi.mock("@/core/sdk/server", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    readSettingStrings: async () => ({
        razorpay_key_id: "rzp_test",
        razorpay_key_secret: "secret",
        razorpay_webhook_secret: SECRET,
    }),
}));

const applyFiltersAsync = vi.fn(async () => ({ handled: true, duplicate: false, error: null }));
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: (...args: unknown[]) => applyFiltersAsync(...args) }));

const { POST } = await import("@/modules/razorpay-gateway/api/webhook/route");
const { NextRequest } = await import("next/server");

const paid = {
    event: "payment_link.paid",
    payload: {
        payment_link: { entity: { id: "plink_1", notes: { reference: "order-1", kind: "order" }, amount: 49900, currency: "INR" } },
        payment: { entity: { id: "pay_1", notes: { reference: "order-1" }, amount: 49900, currency: "INR" } },
    },
};

function webhook(event: unknown, sign: (body: string) => string = (body) => hmac(SECRET, body)) {
    const body = JSON.stringify(event);
    return new NextRequest("https://shop.example/api/v1/razorpay/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-razorpay-signature": sign(body) },
        body,
    });
}

function hmac(secret: string, body: string): string {
    return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function settled() {
    const call = applyFiltersAsync.mock.calls.find((c) => (c as unknown[])[0] === "payment.settled") as unknown as
        | [string, unknown, Record<string, unknown>]
        | undefined;
    return call?.[2];
}

beforeEach(() => {
    applyFiltersAsync.mockClear();
    applyFiltersAsync.mockResolvedValue({ handled: true, duplicate: false, error: null });
});

describe("the Razorpay webhook", () => {
    it("settles a paid link, in rupees rather than paise, under the payment's own id", async () => {
        const res = await POST(webhook(paid));

        expect(res.status).toBe(200);
        expect(settled()).toMatchObject({ reference: "order-1", providerRef: "pay_1", amount: 499, currency: "INR" });
    });

    it("refuses a body signed with another secret", async () => {
        const res = await POST(webhook(paid, (body) => hmac("not-the-secret", body)));

        expect(res.status).toBe(400);
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });

    it("refuses a body changed after it was signed", async () => {
        const genuine = JSON.stringify(paid);
        const signature = hmac(SECRET, genuine);
        const res = await POST(
            new NextRequest("https://shop.example/api/v1/razorpay/webhook", {
                method: "POST",
                headers: { "content-type": "application/json", "x-razorpay-signature": signature },
                body: genuine.replace("49900", "100"),
            }),
        );

        expect(res.status).toBe(400);
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });

    it("refuses a body with no signature at all", async () => {
        const res = await POST(webhook(paid, () => ""));
        expect(res.status).toBe(400);
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });

    it("asks Razorpay to try again when nothing recorded the payment", async () => {
        applyFiltersAsync.mockResolvedValueOnce({ handled: false, duplicate: false, error: "settlement failed" });

        const res = await POST(webhook(paid));

        expect(res.status).toBe(500);
    });

    it("reports a processed refund against the payment it refunds", async () => {
        await POST(webhook({ event: "refund.processed", payload: { refund: { entity: { payment_id: "pay_1", amount: 49900 } } } }));

        expect(settled()).toBeUndefined();
        expect(applyFiltersAsync).toHaveBeenCalledWith(
            "payment.refunded",
            expect.anything(),
            expect.objectContaining({ providerRef: "pay_1", amount: 499 }),
        );
    });
});
