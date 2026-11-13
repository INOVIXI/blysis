/**
 * A coupon a paid order leaves behind for the person who paid it.
 *
 * The reason a shop wants one is a second purchase, so it has to belong to
 * the buyer: a code anybody may type ends up on a forum by the evening and
 * becomes a discount for everybody. It is minted inside the settlement that
 * marks the order paid, so it exists exactly when the order does, and it is
 * keyed by the order, so a settlement delivered twice finds the coupon it
 * already made instead of making a second.
 *
 * Off unless an operator turns it on in the store's settings.
 */
import { randomInt } from "crypto";
import { moduleSettings, prisma, type PrismaTransaction } from "@/core/sdk/server";
import { couponStanding, type CouponStanding } from "./coupon-standing";

const DAY = 86_400_000;

/** No 0/O or 1/I: a code is read off an email and typed into a box. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * The four store settings. A type rather than an interface because the
 * settings reader wants a record of setting values, which an interface is not.
 */
export type ThankYouSettings = {
    thankYouCouponEnabled: boolean;
    thankYouCouponPercent: number;
    thankYouCouponDays: number;
    thankYouCouponMinTotal: number;
};

export interface ThankYouTerms {
    percent: number;
    days: number;
}

/** What the buyer is told: the code, how much it takes off, and until when. */
export interface ThankYouCoupon {
    code: string;
    percent: number;
    expiresAt: Date | null;
}

/**
 * What this order earns, or null when it earns nothing.
 *
 * A free order earns nothing whatever the minimum says. A coupon handed out
 * for an order that cost nothing is a coupon anybody can mint as often as the
 * shop has a free product, which is a discount for everybody again.
 */
export function thankYouTerms(settings: Partial<ThankYouSettings>, total: number): ThankYouTerms | null {
    if (!settings.thankYouCouponEnabled) return null;
    if (!Number.isFinite(total) || total <= 0) return null;
    const minimum = Number(settings.thankYouCouponMinTotal ?? 0);
    if (Number.isFinite(minimum) && minimum > 0 && total < minimum) return null;
    const percent = Math.round(Number(settings.thankYouCouponPercent ?? 0));
    const days = Math.round(Number(settings.thankYouCouponDays ?? 0));
    if (!(percent >= 1 && percent <= 90) || !(days >= 1)) return null;
    return { percent, days };
}

/** Random rather than counted: a code that follows the last one is a code a stranger can guess. */
export function thankYouCode(): string {
    let code = "";
    for (let i = 0; i < 10; i++) code += ALPHABET[randomInt(0, ALPHABET.length)];
    return `THANKS-${code}`;
}

export function readThankYouSettings(): Promise<ThankYouSettings> {
    return moduleSettings<ThankYouSettings>("store");
}

/**
 * Mints the order's coupon on the settlement's transaction, at most once.
 *
 * `skipDuplicates` rather than a create that throws: inside a Postgres
 * transaction a unique violation aborts everything after it, and the thing
 * after it is the payment row of an order somebody paid for. The row read
 * back is whichever coupon the order holds, so a replay answers with the
 * first one's code.
 */
export async function issueThankYouCoupon(
    tx: PrismaTransaction,
    order: { id: string; orderNumber: string; userId: string | null; total: number },
    settings: Partial<ThankYouSettings>,
    now: Date = new Date(),
): Promise<ThankYouCoupon | null> {
    if (!order.userId) return null;
    const terms = thankYouTerms(settings, order.total);
    if (!terms) return null;

    await tx.coupon.createMany({
        data: [{
            code: thankYouCode(),
            description: `Thank-you coupon for order ${order.orderNumber}`,
            type: "PERCENTAGE",
            value: terms.percent,
            usageLimit: 1,
            expiresAt: new Date(now.getTime() + terms.days * DAY),
            productIds: [],
            categoryIds: [],
            userId: order.userId,
            issuedForOrderId: order.id,
            isActive: true,
        }],
        skipDuplicates: true,
    });
    const row = await tx.coupon.findUnique({
        where: { issuedForOrderId: order.id },
        select: { code: true, value: true, expiresAt: true },
    });
    return row ? { code: row.code, percent: Number(row.value), expiresAt: row.expiresAt } : null;
}

/**
 * The way back: a refunded order's coupon stops working, unless it has
 * already been spent. A spent one took its discount off another order that
 * was paid for, and there is nothing left on it to take back.
 */
export async function withdrawThankYouCoupon(tx: PrismaTransaction, orderId: string): Promise<void> {
    await tx.coupon.updateMany({
        where: { issuedForOrderId: orderId, usageCount: 0 },
        data: { isActive: false },
    });
}

/**
 * Whether this member may redeem this coupon.
 *
 * Somebody else's personal coupon is answered as a code that does not exist,
 * not as a code that belongs to somebody: telling a stranger they guessed a
 * real code is telling them to keep guessing near it.
 */
export function couponOpenTo(coupon: { userId?: string | null }, memberId: string): boolean {
    return !coupon.userId || coupon.userId === memberId;
}

/** What a buyer's order list shows beside the order that earned it. */
export interface ThankYouCouponView {
    code: string;
    percent: number;
    expiresAt: Date | null;
    standing: CouponStanding;
}

/**
 * The thank-you coupons these orders earned, for the member who holds them.
 *
 * Keyed by the holder as well as the order: an operator reading everybody's
 * orders sees the orders, not the codes in them, because a code shown is a
 * code that can be used by whoever read it.
 */
export async function thankYouCouponsFor(
    orderIds: readonly string[],
    memberId: string,
): Promise<Record<string, ThankYouCouponView>> {
    if (orderIds.length === 0) return {};
    const rows = await prisma.coupon.findMany({
        where: { issuedForOrderId: { in: [...orderIds] }, userId: memberId },
        select: {
            code: true,
            value: true,
            expiresAt: true,
            isActive: true,
            startsAt: true,
            usageLimit: true,
            usageCount: true,
            issuedForOrderId: true,
        },
        take: orderIds.length,
    });
    const out: Record<string, ThankYouCouponView> = {};
    for (const row of rows) {
        if (!row.issuedForOrderId) continue;
        out[row.issuedForOrderId] = {
            code: row.code,
            percent: Number(row.value),
            expiresAt: row.expiresAt,
            standing: couponStanding(row),
        };
    }
    return out;
}
