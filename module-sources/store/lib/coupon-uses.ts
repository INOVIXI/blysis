/**
 * One customer's uses of one coupon, as the operator's list draws them.
 *
 * Three numbers rather than one, because they answer three questions: how
 * many uses the customer holds (paid orders, which is what the per-customer
 * limit counts when a payment settles), how many are waiting for a payment
 * (held at checkout for an hour, then let go), and how many they were given
 * back by a refund or a cancel. An operator asking "why was this player
 * refused the code" needs the first, and one asking "has this player been
 * gaming refunds" needs the last.
 */
export interface CouponUse {
    couponId: string;
    userId: string | null;
    held: number;
    waiting: number;
    returned: number;
}

const HELD = new Set(["COMPLETED", "PROCESSING"]);
const RETURNED = new Set(["REFUNDED", "CANCELLED"]);

/** The key a customer and a coupon share, with a deleted account kept apart from every live one. */
export function pairKey(couponId: string, userId: string | null): string {
    return `${couponId}:${userId ?? ""}`;
}

/** Folds order counts by coupon, customer and status into one row per coupon and customer. */
export function foldUses(
    rows: readonly { couponId: string | null; userId: string | null; status: string; _count: number }[],
): Map<string, CouponUse> {
    const uses = new Map<string, CouponUse>();
    for (const row of rows) {
        if (!row.couponId) continue;
        const key = pairKey(row.couponId, row.userId);
        const use = uses.get(key) ?? { couponId: row.couponId, userId: row.userId, held: 0, waiting: 0, returned: 0 };
        if (HELD.has(row.status)) use.held += row._count;
        else if (RETURNED.has(row.status)) use.returned += row._count;
        else use.waiting += row._count;
        uses.set(key, use);
    }
    return uses;
}
