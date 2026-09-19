import type { BadgeTone } from "@/core/sdk/ui";

/**
 * Whether a coupon works today, which is what an operator opens the list for.
 *
 * The list drew `isActive` and called it the status. That column is one of
 * four things the basket checks, and the other three are all reasons a
 * switched-on coupon does nothing: it has not started yet, it has passed its
 * end date, or it has been used as many times as it was allowed. All three
 * read "Active" on the screen, which is the answer to a question nobody was
 * asking.
 *
 * The order matters and it is the basket's own: off beats everything, then
 * not yet, then expired, then used up. `computeCouponDiscount` in `pricing.ts`
 * asks them in exactly that order, and the two disagreeing would be worse
 * than either being wrong.
 */
export type CouponStanding = "off" | "scheduled" | "expired" | "usedUp" | "live";

export interface CouponStandingInput {
    isActive: boolean;
    startsAt?: string | Date | null;
    expiresAt?: string | Date | null;
    usageLimit?: number | null;
    usageCount?: number;
}

export function couponStanding(coupon: CouponStandingInput, now: Date = new Date()): CouponStanding {
    if (!coupon.isActive) return "off";
    if (coupon.startsAt && new Date(coupon.startsAt) > now) return "scheduled";
    if (coupon.expiresAt && new Date(coupon.expiresAt) < now) return "expired";
    if (coupon.usageLimit && (coupon.usageCount ?? 0) >= coupon.usageLimit) return "usedUp";
    return "live";
}

/**
 * Green only for the one that works. The other four are not failures - a
 * coupon that has done its job and run out is a success - so they are neutral
 * rather than red, except the one an operator turned off themselves.
 */
export const STANDING_TONE: Record<CouponStanding, BadgeTone> = {
    off: "neutral",
    scheduled: "info",
    expired: "neutral",
    usedUp: "neutral",
    live: "success",
};
