// @vitest-environment node
import { describe, it, expect } from "vitest";
import { couponStanding } from "@/modules/store/lib/coupon-standing";
import { computeCouponDiscount } from "@/modules/store/lib/pricing";

/**
 * The coupons list says whether a code works, which is what it is opened for.
 *
 * It drew `isActive` and called that the status. The basket asks four
 * questions before it will take a code - switched on, started, not expired,
 * not used up - and the list answered only the first, so a coupon whose end
 * date passed last month, or one that has been redeemed as many times as it
 * was allowed, sat in the list reading "Active" while every shopper who typed
 * it was turned away. All three of those are ordinary states for a coupon to
 * reach; the list simply had no word for any of them.
 *
 * The order is the basket's, and the pair being tested here together is the
 * point: the two disagreeing would be worse than either being wrong on its
 * own, because the screen would then be confidently contradicting the till.
 */

const NOW = new Date("2026-06-01T12:00:00Z");
const BASE = { isActive: true, type: "PERCENTAGE", value: 10 };

describe("a coupon's standing", () => {
    it("is 'working' when the basket would take it", () => {
        expect(couponStanding({ ...BASE }, NOW)).toBe("live");
        expect(computeCouponDiscount({ ...BASE }, 100, NOW).error).toBeNull();
    });

    it("says switched off before anything else, as the basket does", () => {
        const coupon = { ...BASE, isActive: false, expiresAt: new Date("2020-01-01") };
        expect(couponStanding(coupon, NOW)).toBe("off");
        expect(computeCouponDiscount(coupon, 100, NOW).error).not.toBeNull();
    });

    it("says not started, for a code that opens later", () => {
        const coupon = { ...BASE, startsAt: new Date("2026-12-01") };
        expect(couponStanding(coupon, NOW)).toBe("scheduled");
        expect(computeCouponDiscount(coupon, 100, NOW).error).not.toBeNull();
    });

    it("says expired rather than active, which is the bug this is about", () => {
        const coupon = { ...BASE, expiresAt: new Date("2026-01-01") };
        expect(couponStanding(coupon, NOW)).toBe("expired");
        expect(computeCouponDiscount(coupon, 100, NOW).error).not.toBeNull();
    });

    it("says used up when the limit has been reached", () => {
        const coupon = { ...BASE, usageLimit: 3, usageCount: 3 };
        expect(couponStanding(coupon, NOW)).toBe("usedUp");
        expect(computeCouponDiscount(coupon, 100, NOW).error).not.toBeNull();
    });

    it("calls nothing 'working' that the basket refuses", () => {
        // The one that matters: the screen may not be more optimistic than
        // the till. A minimum purchase is left out because it depends on the
        // basket rather than on the coupon, and a list has no basket.
        const cases = [
            { ...BASE, isActive: false },
            { ...BASE, startsAt: new Date("2026-12-01") },
            { ...BASE, expiresAt: new Date("2026-01-01") },
            { ...BASE, usageLimit: 1, usageCount: 1 },
            { ...BASE },
        ];
        for (const coupon of cases) {
            const refused = computeCouponDiscount(coupon, 1000, NOW).error !== null;
            expect(couponStanding(coupon, NOW) === "live", JSON.stringify(coupon)).toBe(!refused);
        }
    });
});
