/**
 * How an admin finds a voucher. The id is the whole voucher, so the list shows
 * only its last characters, and a search matches no more of it than that: a
 * longer suffix answered yes or no would read the rest of a spendable id one
 * character at a time.
 */

/** How many of an id's last characters the list shows, and the most a search may match on. */
export const HINT = 6;

export function hintOf(voucherId: string): string {
    return voucherId.slice(-HINT);
}

/** The vouchers a term finds: by the shown end of the id, or by who made or redeemed one. */
export function voucherSearch(term: string, memberIds: string[]) {
    if (!term) return {};
    return {
        OR: [
            ...(term.length <= HINT ? [{ id: { endsWith: term } }] : []),
            { createdById: { in: memberIds } },
            { redeemedById: { in: memberIds } },
        ],
    };
}
