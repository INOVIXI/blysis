/**
 * Talking to Mollie.
 *
 * Mollie's webhook carries a payment id and nothing else - not the status, not
 * the amount. That is deliberate on their side: the only trustworthy source is
 * Mollie itself, so this module reads the payment back with its own API key
 * before it settles anything.
 */
import { readSettingStrings } from "@/core/sdk/server";

export const MOLLIE_API = "https://api.mollie.com/v2";

export interface MollieConfig {
    apiKey: string;
}

async function readSettings(): Promise<Record<string, string | null>> {
    // Through the SDK rather than off the row. The credentials among these
    // keys are encrypted at rest, so a direct read returns ciphertext and
    // the provider rejects it as if the operator had mistyped the key.
    return readSettingStrings(["mollie_api_key"]);
}

export async function getMollieConfig(): Promise<MollieConfig | null> {
    const map = await readSettings();
    const apiKey = map.mollie_api_key ?? process.env.MOLLIE_API_KEY ?? null;
    if (!apiKey) return null;
    return { apiKey };
}

export async function isMollieConfigured(): Promise<boolean> {
    return (await getMollieConfig()) !== null;
}

export interface MolliePayment {
    id?: string;
    status?: string;
    amount?: { value?: string; currency?: string };
    amountRefunded?: { value?: string; currency?: string };
    metadata?: Record<string, string> | null;
    _links?: { checkout?: { href?: string } };
    detail?: string;
}

export async function mollieGet(config: MollieConfig, path: string): Promise<MolliePayment> {
    const response = await fetch(`${MOLLIE_API}${path}`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!response.ok) throw new Error(`Mollie answered ${response.status} for ${path}`);
    return (await response.json()) as MolliePayment;
}

/**
 * An amount the way Mollie wants it: a string with exactly the decimals its
 * currency has. Mollie lists the yen with none
 * (https://docs.mollie.com/docs/multicurrency); a yen amount written as
 * "1000.00" is not the yen's format.
 */
export function mollieValue(amount: number, currency: string): string {
    return currency.toUpperCase() === "JPY" ? Math.round(amount).toFixed(0) : amount.toFixed(2);
}

/** The currencies Mollie settles. It is a European processor first. */
export const MOLLIE_CURRENCIES = new Set([
    "EUR", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN",
    "USD", "CAD", "AUD", "NZD", "JPY", "HKD", "ILS", "ISK",
]);
