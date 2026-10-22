/**
 * Whether a settlement paid for what the store charged.
 *
 * A gateway reports what its provider says moved, and the store used to take
 * that on trust: a checkout link the buyer could edit, or a gateway reading
 * the wrong unit, settled an order for whatever arrived. The store writes down
 * what it asks each gateway to collect, and holds every settlement against it.
 *
 * A settlement that leaves the amount or the currency out is one whose
 * provider does not report it. The gateway fixed both when the payment
 * started, behind a signature or a server-side session, so what it leaves out
 * is taken as charged.
 */

export interface Charge {
    amount: number;
    currency: string;
}

/** Why a settlement does not pay for the charge, or null when it does. */
export function chargeShortfall(
    charge: Charge,
    paid: { amount: number | null; currency: string | null },
): string | null {
    const charged = charge.currency.toUpperCase();
    if (paid.currency !== null && paid.currency.toUpperCase() !== charged) {
        return `paid in ${paid.currency.toUpperCase()}, charged in ${charged}`;
    }
    // In cents, so a float a gateway's arithmetic produced does not fall a
    // hair short, and written so that NaN fails rather than passes.
    if (paid.amount !== null && !(Math.round(paid.amount * 100) >= Math.round(charge.amount * 100))) {
        return `paid ${paid.amount} ${charged}, charged ${charge.amount} ${charged}`;
    }
    return null;
}
