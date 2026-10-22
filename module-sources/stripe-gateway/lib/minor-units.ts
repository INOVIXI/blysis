/**
 * Amounts in the currency's smallest unit, the way Stripe takes them.
 *
 * Stripe's amounts are integers, and the smallest unit is not always a
 * hundredth. Everything was multiplied by a hundred, which charged a shop in
 * yen a hundred times the price on the page; the webhook divided it back, so
 * the order looked paid for exactly what it cost.
 * `tests/modules/stripe-gateway/a-yen-is-not-a-hundred-cents.test.ts`.
 *
 * The lists are Stripe's: https://docs.stripe.com/currencies
 */

const ZERO_DECIMAL = new Set([
    "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const THREE_DECIMAL = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

function unitsPerMajor(currency: string): number {
    const code = currency.toUpperCase();
    if (ZERO_DECIMAL.has(code)) return 1;
    if (THREE_DECIMAL.has(code)) return 1000;
    return 100;
}

/** Major units to the integer Stripe is asked for. */
export function toStripeAmount(amount: number, currency: string): number {
    const units = unitsPerMajor(currency);
    // Stripe refuses a three-decimal amount whose last digit is not zero, and
    // the shop prices in hundredths anyway.
    if (units === 1000) return Math.round(amount * 100) * 10;
    return Math.round(amount * units);
}

/** The integer Stripe reports, back to major units. */
export function fromStripeAmount(amount: number, currency: string): number {
    return amount / unitsPerMajor(currency);
}
