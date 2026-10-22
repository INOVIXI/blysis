/**
 * Talking to CoinPayments.
 *
 * This module uses the hosted checkout rather than the merchant API: the
 * payment is a link, and the only credential that has to exist on the server
 * is the IPN secret used to verify what comes back. That is a smaller secret
 * to hold than an API key pair. It has two jobs, because a hosted checkout
 * can be abused two ways: a forged IPN, which the signature refuses, and a
 * real payment from a link the buyer edited, which `checkoutBinding` refuses.
 */
import crypto from "crypto";
import { readSettingStrings } from "@/core/sdk/server";

export const COINPAYMENTS_CHECKOUT = "https://www.coinpayments.net/index.php";

export interface CoinPaymentsConfig {
    merchantId: string;
    ipnSecret: string | null;
}

async function readSettings(): Promise<Record<string, string | null>> {
    // Through the SDK rather than off the row. The credentials among these
    // keys are encrypted at rest, so a direct read returns ciphertext and
    // the provider rejects it as if the operator had mistyped the key.
    return readSettingStrings(["coinpayments_merchant_id", "coinpayments_ipn_secret"]);
}

export async function getCoinPaymentsConfig(): Promise<CoinPaymentsConfig | null> {
    const map = await readSettings();
    const merchantId = map.coinpayments_merchant_id ?? process.env.COINPAYMENTS_MERCHANT_ID ?? null;
    if (!merchantId) return null;
    return { merchantId, ipnSecret: map.coinpayments_ipn_secret ?? process.env.COINPAYMENTS_IPN_SECRET ?? null };
}

/**
 * Configured means both halves. Without the IPN secret nothing could ever be
 * settled, so offering the button would take money and grant nothing.
 */
export async function isCoinPaymentsConfigured(): Promise<boolean> {
    const config = await getCoinPaymentsConfig();
    return config !== null && config.ipnSecret !== null;
}

/**
 * What a checkout link was made for, under the IPN secret.
 *
 * The amount and currency of a hosted checkout are query parameters the
 * buyer's browser holds, and CoinPayments charges whatever they say. An IPN
 * for a payment of a cent is as genuinely signed as one for the full price,
 * so the signature proves who sent it and nothing about what was owed. This
 * travels as `custom`, which CoinPayments echoes back, and an IPN is settled
 * only when its reference, amount and currency still produce it.
 * `tests/modules/coinpayments-gateway/a-checkout-pays-the-amount-it-was-given.test.ts`.
 */
export function checkoutBinding(secret: string, reference: string, amount: number, currency: string): string {
    return crypto
        .createHmac("sha256", secret)
        .update(`${reference}|${amount.toFixed(2)}|${currency.toUpperCase()}`)
        .digest("hex");
}

/** The fiat currencies CoinPayments prices a hosted checkout in. */
export const COINPAYMENTS_CURRENCIES = new Set([
    "USD", "EUR", "GBP", "CAD", "AUD", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK",
    "JPY", "SGD", "HKD", "NZD", "INR", "BRL", "MXN", "TRY", "ZAR", "RUB",
]);

/**
 * CoinPayments reports progress as a number: negative is dead, 100 (or 2, for
 * a PayPal-style "queued for payout") means the coins are ours.
 */
export function statusOf(status: number): "complete" | "failed" | "pending" {
    if (status >= 100 || status === 2) return "complete";
    if (status < 0) return "failed";
    return "pending";
}
