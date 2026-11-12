// @vitest-environment node
/**
 * PayTR's two hashes and the order id that has to survive a round trip.
 *
 * Everything PayTR trusts is one HMAC recipe used in both directions, so a
 * mistake in it is either a payment that never starts or, worse, a callback
 * this site accepts from anyone. The fixtures below are computed the way
 * PayTR's own documentation spells the strings out.
 */
import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";

vi.mock("@/core/sdk/server", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }, prisma: {} }));

const { paytrHash, paytrCallbackHash, paytrCurrency, toMerchantOid, fromMerchantOid } = await import(
    "@/modules/paytr-gateway/lib/paytr"
);

const config = { merchantId: "123456", merchantKey: "key", merchantSalt: "salt", testMode: true };

describe("paytrHash", () => {
    it("is a base64 HMAC-SHA256 of the string plus the salt, keyed by the merchant key", () => {
        const expected = crypto.createHmac("sha256", "key").update("payloadsalt").digest("base64");
        expect(paytrHash(config, "payload")).toBe(expected);
    });

    // The salt is appended, not prepended, and not used as the key. Each of
    // those three mistakes produces a plausible-looking hash that PayTR rejects.
    it("does not key the HMAC with the salt", () => {
        const wrong = crypto.createHmac("sha256", "salt").update("payloadkey").digest("base64");
        expect(paytrHash(config, "payload")).not.toBe(wrong);
    });
});

// PayTR signs a callback as merchant_oid + merchant_salt + status +
// total_amount, with the salt in the middle and nothing appended. Signing it
// with the payment recipe added the salt a second time at the end, so no
// genuine callback verified and no card order was ever settled.
describe("paytrCallbackHash", () => {
    it("is the HMAC of oid, salt, status and amount, with the salt once and in the middle", () => {
        const expected = crypto.createHmac("sha256", "key").update("abc123" + "salt" + "success" + "10000").digest("base64");
        expect(paytrCallbackHash(config, "abc123", "success", "10000")).toBe(expected);
    });

    it("does not append the salt again", () => {
        const doubled = crypto.createHmac("sha256", "key").update("abc123saltsuccess10000salt").digest("base64");
        expect(paytrCallbackHash(config, "abc123", "success", "10000")).not.toBe(doubled);
    });
});

describe("paytrCurrency", () => {
    it("calls the Turkish lira TL, which is the only name PayTR answers to", () => {
        expect(paytrCurrency("TRY")).toBe("TL");
        expect(paytrCurrency("try")).toBe("TL");
    });

    it("passes through the four other currencies PayTR takes", () => {
        expect(paytrCurrency("USD")).toBe("USD");
        expect(paytrCurrency("EUR")).toBe("EUR");
    });

    // Answering "null" is what keeps the button off the checkout page.
    it("refuses a currency PayTR cannot settle", () => {
        expect(paytrCurrency("JPY")).toBeNull();
    });
});

describe("the merchant order id", () => {
    it("leaves an ordinary reference alone", () => {
        expect(toMerchantOid("clh2x9f0000abcdef")).toBe("clh2x9f0000abcdef");
    });

    // PayTR takes letters and digits only. A reference it would mangle is
    // encoded instead, because a callback for an order id nobody recognises
    // is a payment that cannot be settled.
    it("round-trips a reference PayTR would refuse", () => {
        const awkward = "order-1/2 3";
        const oid = toMerchantOid(awkward);
        expect(oid).toMatch(/^[a-zA-Z0-9]+$/);
        expect(fromMerchantOid(oid)).toBe(awkward);
    });

    it("round-trips an ordinary reference too", () => {
        expect(fromMerchantOid(toMerchantOid("abc123"))).toBe("abc123");
    });
});
