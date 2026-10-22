/**
 * The answers the store gives a gateway about a payment.
 *
 * `handled` is what a gateway acts on: true and it acknowledges its provider,
 * false and it fails the notification so the provider tries again and the
 * operator hears of it. Settling and cancelling both answer in these words,
 * for orders and credit purchases alike.
 */

export const OK: PaymentOutcome = { handled: true, duplicate: false, error: null };
export const ALREADY: PaymentOutcome = { handled: true, duplicate: true, error: null };

/** Dealt with, and nothing to do: the reference is not one that can be settled. */
export function failed(error: string): PaymentOutcome {
    return { handled: true, duplicate: false, error };
}

/**
 * Not recorded. For money that arrived and must not be acknowledged as
 * settled: less than was charged, or in another currency.
 */
export function refused(error: string): PaymentOutcome {
    return { handled: false, duplicate: false, error };
}
