import { AWAITING_PAYMENT_MS } from "./availability";

/**
 * How many times one customer has used a coupon, and whether one more order
 * would take them past what the coupon allows each customer.
 *
 * The uses are counted from the orders that carry the coupon rather than
 * kept in a counter. A counter has to be given back by every path that undoes
 * an order - a refund, a cancel, a checkout nobody paid - and the coupon's
 * own `usageCount` shows how that goes: nothing gives it back. Counting the
 * orders means a refunded or cancelled order stops counting the moment its
 * status changes, which is the rule: the customer did not keep the discount,
 * so they keep the use.
 */

/** The orders that hold a use: paid ones, and with `awaiting`, checkouts of the last hour still waiting for a payment. */
function holding(now: Date, awaiting: boolean) {
    const paid = { status: { in: ["COMPLETED", "PROCESSING"] } };
    return awaiting
        ? { OR: [paid, { status: "PENDING", createdAt: { gte: new Date(now.getTime() - AWAITING_PAYMENT_MS) } }] }
        : paid;
}

interface OrderCounter {
    order: {
        count(args: { where: Record<string, unknown> }): Promise<number>;
    };
}

interface LimitReader extends OrderCounter {
    coupon: {
        findUnique(args: {
            where: { id: string };
            select: { perCustomerLimit: true };
        }): Promise<{ perCustomerLimit: number | null } | null>;
    };
    $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/**
 * Orders this customer holds with the coupon.
 *
 * At checkout the count includes their checkouts of the last hour still
 * waiting for a payment, the same window a per-person product limit holds:
 * ten payment pages opened at once must not all read "not used yet". When a
 * payment settles it counts paid orders only and leaves out the order being
 * settled, which is `pastCouponLimit` below.
 */
export function customerUses(
    db: OrderCounter,
    couponId: string,
    userId: string,
    now: Date,
    options: { paidOnly?: boolean; exceptOrderId?: string } = {},
): Promise<number> {
    return db.order.count({
        where: {
            couponId,
            userId,
            ...holding(now, !options.paidOnly),
            ...(options.exceptOrderId ? { id: { not: options.exceptOrderId } } : {}),
        },
    });
}

/**
 * Whether one more order with this coupon takes the customer past its
 * per-customer limit, counted again under a lock.
 *
 * For an order that is about to be paid: the count at checkout is a snapshot,
 * and two checkouts opened together both passed it. The lock is per customer
 * and coupon, so two settlements for the same pair wait for each other and
 * the second sees the first. `exceptOrderId` is the order being settled,
 * which must not count against itself.
 *
 * A coupon with no per-customer limit, or one deleted since the order was
 * placed, takes no lock and passes.
 */
export async function pastCouponLimit(
    tx: LimitReader,
    couponId: string | null | undefined,
    userId: string | null | undefined,
    now: Date,
    exceptOrderId?: string,
): Promise<boolean> {
    if (!couponId || !userId) return false;
    const coupon = await tx.coupon.findUnique({ where: { id: couponId }, select: { perCustomerLimit: true } });
    if (!coupon?.perCustomerLimit) return false;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`store-coupon:${userId}:${couponId}`}))`;
    const used = await customerUses(tx, couponId, userId, now, { paidOnly: true, exceptOrderId });
    return used + 1 > coupon.perCustomerLimit;
}
