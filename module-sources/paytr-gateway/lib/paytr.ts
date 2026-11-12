/**
 * Talking to PayTR.
 *
 * Everything PayTR checks is a base64 HMAC over a string built in a fixed
 * order, with the merchant salt appended and the merchant key as the secret.
 * Both directions use the same primitive, so both live here: a token that
 * fails silently and a callback that verifies wrongly are the same bug.
 */
import crypto from "crypto";
import { readSettingStrings } from "@/core/sdk/server";

export interface PaytrConfig {
    merchantId: string;
    merchantKey: string;
    merchantSalt: string;
    testMode: boolean;
}

async function readSettings(): Promise<Record<string, string | null>> {
    // Through the SDK rather than off the row. The credentials among these
    // keys are encrypted at rest, so a direct read returns ciphertext and
    // the provider rejects it as if the operator had mistyped the key.
    return readSettingStrings([
        "paytr_merchant_id",
        "paytr_merchant_key",
        "paytr_merchant_salt",
        "paytr_test_mode",
    ]);
}

export async function getPaytrConfig(): Promise<PaytrConfig | null> {
    const map = await readSettings();
    const merchantId = map.paytr_merchant_id ?? process.env.PAYTR_MERCHANT_ID ?? null;
    const merchantKey = map.paytr_merchant_key ?? process.env.PAYTR_MERCHANT_KEY ?? null;
    const merchantSalt = map.paytr_merchant_salt ?? process.env.PAYTR_MERCHANT_SALT ?? null;
    if (!merchantId || !merchantKey || !merchantSalt) return null;

    return {
        merchantId,
        merchantKey,
        merchantSalt,
        testMode: (map.paytr_test_mode ?? process.env.PAYTR_TEST_MODE ?? "") === "true",
    };
}

export async function isPaytrConfigured(): Promise<boolean> {
    return (await getPaytrConfig()) !== null;
}

export function paytrHash(config: PaytrConfig, parts: string): string {
    return crypto.createHmac("sha256", config.merchantKey).update(parts + config.merchantSalt).digest("base64");
}

/**
 * What PayTR signs a callback with: the salt sits between the order id and
 * the status and is not appended again, unlike the payment token's recipe
 * that `paytrHash` follows (`paytr.test.ts`).
 */
export function paytrCallbackHash(config: PaytrConfig, merchantOid: string, status: string, totalAmount: string): string {
    return crypto
        .createHmac("sha256", config.merchantKey)
        .update(merchantOid + config.merchantSalt + status + totalAmount)
        .digest("base64");
}

/** PayTR names the Turkish lira "TL" and takes four other currencies. */
export function paytrCurrency(currency: string): string | null {
    const map: Record<string, string> = { TRY: "TL", USD: "USD", EUR: "EUR", GBP: "GBP", RUB: "RUB" };
    return map[currency.toUpperCase()] ?? null;
}

/**
 * PayTR's order id accepts letters and digits only, and our references are
 * cuids, which already are. Anything else is hex-encoded so the callback can
 * turn it back into the reference the store knows, rather than being handed a
 * mangled id that matches no order.
 */
export function toMerchantOid(reference: string): string {
    if (/^[a-zA-Z0-9]+$/.test(reference)) return reference;
    return `hx${Buffer.from(reference, "utf8").toString("hex")}`;
}

export function fromMerchantOid(oid: string): string {
    if (!oid.startsWith("hx")) return oid;
    return Buffer.from(oid.slice(2), "hex").toString("utf8");
}

export const PAYTR_TOKEN_URL = "https://www.paytr.com/odeme/api/get-token";
export const PAYTR_PAY_URL = "https://www.paytr.com/odeme/guvenli";
