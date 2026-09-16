/**
 * The integers this integration answers with.
 *
 * Its schema asks for `orderStatusId` and `PaymentTypeId` as integers, and
 * says the values in an order must be the ones `/api/orderStatus` and
 * `/api/paymentMethods` published. Both of ours published strings - the status
 * enum name and the gateway's own id - so the three endpoints agreed with each
 * other and with nothing in the document.
 *
 * The statuses are a fixed list and get fixed numbers, which is the only kind
 * that is safe: the integrator stores the mapping, and a number that moved
 * would relabel every order it had already fetched.
 *
 * A payment method is not a fixed list - a gateway arrives with a module - so
 * its number is derived from its own id rather than from its position in a
 * list that changes when something is installed. The same gateway therefore
 * keeps the same number for ever, which is the property that matters; two ids
 * landing on one number is possible in principle and has a floor of about two
 * billion values against a few dozen gateways.
 */

/** Fixed, because the integrator stores what we publish. */
export const STATUS_IDS: Record<string, number> = {
    PENDING: 1,
    PROCESSING: 2,
    COMPLETED: 3,
    CANCELLED: 4,
    REFUNDED: 5,
};

/** FNV-1a, masked to a positive 31-bit integer. Deterministic for one id. */
export function integerFor(id: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < id.length; index++) {
        hash ^= id.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    // Never zero: the integrator treats an id it does not know as absent, and
    // zero is what an empty field decodes to.
    return (hash >>> 1) || 1;
}

/**
 * The shop's own word for a status the integrator named.
 *
 * Paid unless it says otherwise: an unpaid order is not a sale, and invoicing
 * one is a document somebody cancels by hand later. Null for a number or a
 * word this shop never published, which the caller answers rather than
 * quietly widening the window.
 */
export function statusNameFor(asked: number | string | undefined): string | null {
    if (asked === undefined) return "COMPLETED";
    if (typeof asked === "number") {
        const found = Object.entries(STATUS_IDS).find(([, id]) => id === asked);
        return found ? found[0] : null;
    }
    const upper = asked.toUpperCase();
    return upper in STATUS_IDS ? upper : null;
}
