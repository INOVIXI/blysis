// @vitest-environment node
/**
 * A Coinbase Commerce charge settles on `charge:confirmed`, and on nothing
 * else.
 *
 * A coin payment is reported the moment it is broadcast, while it can still be
 * dropped; granting on that would hand out products for transactions that
 * never land. Every event is signed with the shared webhook secret over the
 * exact body, and one that does not verify is refused before it is read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

const SECRET = "cc-secret";

vi.mock("@/core/sdk/server", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    readSettingStrings: async () => ({ coinbase_api_key: "cc-key", coinbase_webhook_secret: SECRET }),
}));

const applyFiltersAsync = vi.fn(async () => ({ handled: true, duplicate: false, error: null }));
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: (...args: unknown[]) => applyFiltersAsync(...args) }));

const { POST } = await import("@/modules/coinbase-commerce-gateway/api/webhook/route");
const { NextRequest } = await import("next/server");

function event(type: string) {
    return {
        event: {
            type,
            data: {
                id: "charge-uuid",
                code: "ABC123",
                metadata: { reference: "order-1", kind: "order" },
                pricing: { local: { amount: "49.99", currency: "USD" } },
            },
        },
    };
}

function webhook(payload: unknown, secret = SECRET) {
    const body = JSON.stringify(payload);
    return new NextRequest("https://shop.example/api/v1/coinbase-commerce/webhook", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-cc-webhook-signature": crypto.createHmac("sha256", secret).update(body).digest("hex"),
        },
        body,
    });
}

function asked(hook: string) {
    const call = applyFiltersAsync.mock.calls.find((c) => (c as unknown[])[0] === hook) as unknown as
        | [string, unknown, Record<string, unknown>]
        | undefined;
    return call?.[2];
}

beforeEach(() => {
    applyFiltersAsync.mockClear();
    applyFiltersAsync.mockResolvedValue({ handled: true, duplicate: false, error: null });
});

describe("a Coinbase Commerce webhook", () => {
    it("settles a confirmed charge for its local price, under the charge's code", async () => {
        const res = await POST(webhook(event("charge:confirmed")));

        expect(res.status).toBe(200);
        expect(asked("payment.settled")).toMatchObject({
            reference: "order-1",
            providerRef: "ABC123",
            amount: 49.99,
            currency: "USD",
        });
    });

    it("settles nothing for a charge that is only pending", async () => {
        await POST(webhook(event("charge:pending")));
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });

    it("cancels the order for a charge that failed", async () => {
        await POST(webhook(event("charge:failed")));
        expect(asked("payment.voided")).toMatchObject({ reference: "order-1", provider: "coinbase-commerce" });
        expect(asked("payment.settled")).toBeUndefined();
    });

    it("refuses an event signed with another secret", async () => {
        const res = await POST(webhook(event("charge:confirmed"), "not-the-secret"));
        expect(res.status).toBe(400);
        expect(applyFiltersAsync).not.toHaveBeenCalled();
    });

    it("asks Coinbase to try again when nothing recorded a confirmed charge", async () => {
        applyFiltersAsync.mockResolvedValueOnce({ handled: false, duplicate: false, error: "settlement failed" });
        const res = await POST(webhook(event("charge:confirmed")));
        expect(res.status).toBe(500);
    });
});
