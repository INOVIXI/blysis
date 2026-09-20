// @vitest-environment node
/**
 * Unit tests for the store checkout money math, extracted into
 * module-sources/store/lib/pricing.ts (and synced to src/modules/store) so it
 * can be tested without a DB / Stripe / auth. The route now imports these
 * helpers instead of inlining the arithmetic - behaviour is identical.
 *
 * We import the canonical source copy (module-sources). The src/modules copy
 * is a byte-for-byte sync of the same file.
 *
 * Coverage:
 *   - computeOrderPricing: plain subtotal, per-line bulk discount (best match
 *     wins, ordered desc), category vs product vs global bulk targeting,
 *     cumulative-upgrade credit, min-quantity gate
 *   - computeCouponDiscount: percentage vs fixed, maxDiscount cap, fixed
 *     clamped to subtotal, min-purchase gate, expiry / not-yet-active /
 *     usage-cap / inactive rejections
 *   - computeCreatorDiscount: percentage of the post-coupon subtotal
 *   - computeTotals: tax rounding, discount clamp (never negative)
 */
import { describe, it, expect } from "vitest";
import {
    computeOrderPricing,
    computeCouponDiscount,
    computeCreatorDiscount,
    computeTotals,
    type PricingProduct,
    type PricingBulkDiscount,
} from "../../module-sources/store/lib/pricing";

const noOwned = new Set<string>();

function product(over: Partial<PricingProduct> & { id: string; price: number }): PricingProduct {
    return { name: over.id, type: "ONE_TIME", categoryId: null, ...over };
}

describe("computeOrderPricing", () => {
    it("sums a plain subtotal with no discounts", () => {
        const products = [product({ id: "p1", price: 10 }), product({ id: "p2", price: 5 })];
        const { subtotal, orderItems } = computeOrderPricing({
            items: [{ productId: "p1", quantity: 2 }, { productId: "p2", quantity: 3 }],
            products,
            bulkDiscounts: [],
            ownedProductIds: noOwned,
            // Nothing owned off the basket: these are not about the upgrade credit.
            ownedRungs: [],
        });
        expect(subtotal).toBe(10 * 2 + 5 * 3);
        expect(orderItems).toHaveLength(2);
        expect(orderItems[0].price).toBe(10);
        expect(orderItems[0].metadata.bulkDiscount).toBeUndefined();
    });

    it("applies a global bulk discount when minQuantity is met", () => {
        const products = [product({ id: "p1", price: 100 })];
        const bulk: PricingBulkDiscount[] = [
            { minQuantity: 3, discountPercent: 20, productIds: [], categoryIds: [] },
        ];
        const { subtotal, orderItems } = computeOrderPricing({
            items: [{ productId: "p1", quantity: 3 }],
            products,
            bulkDiscounts: bulk,
            ownedProductIds: noOwned,
            // Nothing owned off the basket: these are not about the upgrade credit.
            ownedRungs: [],
        });
        // 100 * 0.8 = 80 per unit * 3 = 240
        expect(orderItems[0].price).toBe(80);
        expect(orderItems[0].metadata.bulkDiscount).toBe(20);
        expect(subtotal).toBe(240);
    });

    it("does NOT apply a bulk discount below minQuantity", () => {
        const products = [product({ id: "p1", price: 100 })];
        const bulk: PricingBulkDiscount[] = [
            { minQuantity: 5, discountPercent: 20, productIds: [], categoryIds: [] },
        ];
        const { subtotal, orderItems } = computeOrderPricing({
            items: [{ productId: "p1", quantity: 2 }],
            products,
            bulkDiscounts: bulk,
            ownedProductIds: noOwned,
            // Nothing owned off the basket: these are not about the upgrade credit.
            ownedRungs: [],
        });
        expect(orderItems[0].price).toBe(100);
        expect(subtotal).toBe(200);
    });

    it("picks the best matching bulk tier, whatever order the rules arrive in", () => {
        const products = [product({ id: "p1", price: 100 })];
        // The route used to have to fetch these `orderBy discountPercent
        // desc` because the first match won. The rung is chosen now, so the
        // weaker rule is listed first here on purpose.
        const bulk: PricingBulkDiscount[] = [
            { minQuantity: 2, discountPercent: 10, productIds: [], categoryIds: [] },
            { minQuantity: 2, discountPercent: 30, productIds: [], categoryIds: [] },
        ];
        const { orderItems } = computeOrderPricing({
            items: [{ productId: "p1", quantity: 2 }],
            products,
            bulkDiscounts: bulk,
            ownedProductIds: noOwned,
            // Nothing owned off the basket: these are not about the upgrade credit.
            ownedRungs: [],
        });
        expect(orderItems[0].price).toBe(70);
        expect(orderItems[0].metadata.bulkDiscount).toBe(30);
    });

    it("targets a product-specific bulk discount over a non-matching one", () => {
        // p1 carries a category so the product-targeted (categoryId:null)
        // discount can't slip in via the null==null category fallthrough.
        const products = [
            product({ id: "p1", price: 100, categoryId: "other" }),
            product({ id: "p2", price: 50, categoryId: "other" }),
        ];
        const bulk: PricingBulkDiscount[] = [
            { minQuantity: 1, discountPercent: 50, productIds: ["p2"], categoryIds: [] },
        ];
        const { orderItems } = computeOrderPricing({
            items: [{ productId: "p1", quantity: 1 }, { productId: "p2", quantity: 1 }],
            products,
            bulkDiscounts: bulk,
            ownedProductIds: noOwned,
            // Nothing owned off the basket: these are not about the upgrade credit.
            ownedRungs: [],
        });
        const p1 = orderItems.find((i) => i.productId === "p1")!;
        const p2 = orderItems.find((i) => i.productId === "p2")!;
        expect(p1.price).toBe(100); // discount is targeted at p2 only
        expect(p2.price).toBe(25); // 50% off 50
    });

    it("leaves a product the rule does not name alone, category or no category", () => {
        /*
         * This used to be written down as a quirk to preserve, and it was a
         * shop taking money off the wrong things. The matcher asked
         * `bd.categoryId === product.categoryId`, and on a shop whose
         * products carry no category that is `null === null`: a rule aimed at
         * one product discounted every uncategorised product beside it. Half
         * price on the whole shelf, from a rule naming one thing.
         *
         * A rule covers what it names. Naming nothing is the only way to
         * cover everything, and it is a thing an operator can see they did.
         */
        const products = [product({ id: "p1", price: 100 }), product({ id: "p2", price: 50 })];
        const bulk: PricingBulkDiscount[] = [
            { minQuantity: 1, discountPercent: 50, productIds: ["p2"], categoryIds: [] },
        ];
        const { orderItems } = computeOrderPricing({
            items: [{ productId: "p1", quantity: 1 }],
            products,
            bulkDiscounts: bulk,
            ownedProductIds: noOwned,
            // Nothing owned off the basket: these are not about the upgrade credit.
            ownedRungs: [],
        });
        expect(orderItems[0].price).toBe(100);
    });

    it("applies a category-targeted bulk discount", () => {
        const products = [product({ id: "p1", price: 80, categoryId: "ranks" })];
        const bulk: PricingBulkDiscount[] = [
            { minQuantity: 1, discountPercent: 25, productIds: [], categoryIds: ["ranks"] },
        ];
        const { orderItems } = computeOrderPricing({
            items: [{ productId: "p1", quantity: 1 }],
            products,
            bulkDiscounts: bulk,
            ownedProductIds: noOwned,
            // Nothing owned off the basket: these are not about the upgrade credit.
            ownedRungs: [],
        });
        expect(orderItems[0].price).toBe(60);
    });

    it("cumulative upgrade: charges only the price difference vs the highest cheaper owned in-category", () => {
        const products = [
            product({ id: "vip", price: 30, categoryId: "ranks" }),
            product({ id: "mvp", price: 50, categoryId: "ranks" }),
        ];
        const { subtotal, orderItems } = computeOrderPricing({
            items: [{ productId: "mvp", quantity: 1 }],
            products,
            bulkDiscounts: [],
            ownedProductIds: new Set(["vip"]),
            // Nothing owned off the basket: these are not about the upgrade credit.
            ownedRungs: [],
        });
        // owns vip (30) in same category, buying mvp (50) -> pay 20
        expect(orderItems[0].price).toBe(20);
        expect(subtotal).toBe(20);
    });

    it("cumulative upgrade never goes negative when owned is pricier", () => {
        const products = [
            product({ id: "cheap", price: 10, categoryId: "ranks" }),
            product({ id: "expensive", price: 50, categoryId: "ranks" }),
        ];
        // Buy the cheap one while owning the expensive one: owned must be
        // strictly cheaper to trigger upgrade, so price stays full.
        const { orderItems } = computeOrderPricing({
            items: [{ productId: "cheap", quantity: 1 }],
            products,
            bulkDiscounts: [],
            ownedProductIds: new Set(["expensive"]),
            // Nothing owned off the basket: these are not about the upgrade credit.
            ownedRungs: [],
        });
        expect(orderItems[0].price).toBe(10);
    });

    it("upgrade + bulk stack: upgrade credit first, then bulk percent off the remainder", () => {
        const products = [
            product({ id: "vip", price: 30, categoryId: "ranks" }),
            product({ id: "mvp", price: 50, categoryId: "ranks" }),
        ];
        const bulk: PricingBulkDiscount[] = [
            { minQuantity: 1, discountPercent: 50, productIds: [], categoryIds: ["ranks"] },
        ];
        const { orderItems } = computeOrderPricing({
            items: [{ productId: "mvp", quantity: 1 }],
            products,
            bulkDiscounts: bulk,
            ownedProductIds: new Set(["vip"]),
            // Nothing owned off the basket: these are not about the upgrade credit.
            ownedRungs: [],
        });
        // 50 - 30 (upgrade) = 20, then 50% bulk -> 10
        expect(orderItems[0].price).toBe(10);
    });

    it("carries product variables into item metadata", () => {
        const products = [product({ id: "p1", price: 5 })];
        const { orderItems } = computeOrderPricing({
            items: [{ productId: "p1", quantity: 1 }],
            products,
            bulkDiscounts: [],
            ownedProductIds: noOwned,
            // Nothing owned off the basket: these are not about the upgrade credit.
            ownedRungs: [],
            variables: { p1: { ign: "Steve" } },
        });
        expect(orderItems[0].metadata.variables).toEqual({ ign: "Steve" });
    });
});

describe("computeCouponDiscount", () => {
    const base = { isActive: true, value: 0, type: "FIXED" } as const;

    it("percentage coupon discounts the subtotal by value%", () => {
        const r = computeCouponDiscount({ ...base, type: "PERCENTAGE", value: 25 }, 100);
        expect(r.error).toBeNull();
        expect(r.discount).toBe(25);
    });

    it("percentage coupon is capped by maxDiscount", () => {
        const r = computeCouponDiscount(
            { ...base, type: "PERCENTAGE", value: 50, maxDiscount: 10 },
            100
        );
        expect(r.discount).toBe(10);
    });

    it("fixed coupon subtracts a flat amount", () => {
        const r = computeCouponDiscount({ ...base, type: "FIXED", value: 15 }, 100);
        expect(r.discount).toBe(15);
    });

    it("fixed coupon is clamped to the subtotal (never over-discounts)", () => {
        const r = computeCouponDiscount({ ...base, type: "FIXED", value: 999 }, 40);
        expect(r.discount).toBe(40);
    });

    it("rejects an inactive coupon", () => {
        const r = computeCouponDiscount({ ...base, isActive: false, value: 10 }, 100);
        expect(r.error).toMatch(/not found or inactive/i);
        expect(r.discount).toBe(0);
    });

    it("rejects a null coupon (not found)", () => {
        const r = computeCouponDiscount(null, 100);
        expect(r.error).toMatch(/not found or inactive/i);
    });

    it("rejects when below minPurchase", () => {
        const r = computeCouponDiscount(
            { ...base, type: "PERCENTAGE", value: 10, minPurchase: 50 },
            40
        );
        expect(r.error).toMatch(/minimum purchase of 50/i);
        expect(r.discount).toBe(0);
    });

    it("allows when subtotal meets minPurchase exactly", () => {
        const r = computeCouponDiscount(
            { ...base, type: "PERCENTAGE", value: 10, minPurchase: 50 },
            50
        );
        expect(r.error).toBeNull();
        expect(r.discount).toBe(5);
    });

    it("rejects an expired coupon", () => {
        const now = new Date("2026-05-30T00:00:00Z");
        const r = computeCouponDiscount(
            { ...base, type: "FIXED", value: 10, expiresAt: new Date("2026-01-01T00:00:00Z") },
            100,
            now
        );
        expect(r.error).toMatch(/expired/i);
    });

    it("rejects a not-yet-active coupon", () => {
        const now = new Date("2026-05-30T00:00:00Z");
        const r = computeCouponDiscount(
            { ...base, type: "FIXED", value: 10, startsAt: new Date("2026-12-01T00:00:00Z") },
            100,
            now
        );
        expect(r.error).toMatch(/not yet active/i);
    });

    it("rejects when usage limit is reached", () => {
        const r = computeCouponDiscount(
            { ...base, type: "FIXED", value: 10, usageLimit: 5, usageCount: 5 },
            100
        );
        expect(r.error).toMatch(/usage limit/i);
    });
});

describe("computeCreatorDiscount", () => {
    it("is a percentage of the post-coupon subtotal", () => {
        // subtotal 100, coupon 20 -> afterCoupon 80, 10% creator -> 8
        expect(computeCreatorDiscount(100, 20, 10)).toBe(8);
    });

    it("is zero for a 0% creator code", () => {
        expect(computeCreatorDiscount(100, 0, 0)).toBe(0);
    });
});

describe("computeTotals", () => {
    it("rolls up discount + tax into the final total", () => {
        // subtotal 100, discounts 0, tax 10% -> taxable 100, tax 10, total 110
        const r = computeTotals({ subtotal: 100, couponDiscount: 0, creatorDiscount: 0, taxRate: 10 });
        expect(r.totalDiscount).toBe(0);
        expect(r.taxableAmount).toBe(100);
        expect(r.tax).toBe(10);
        expect(r.total).toBe(110);
    });

    it("rounds tax to cents (Math.round of taxable*rate)/100", () => {
        // taxable 33.33 * 7 = 233.31 -> round 233 /100 = 2.33
        const r = computeTotals({ subtotal: 33.33, couponDiscount: 0, creatorDiscount: 0, taxRate: 7 });
        expect(r.tax).toBe(2.33);
    });

    it("applies no tax when rate is 0", () => {
        const r = computeTotals({ subtotal: 50, couponDiscount: 0, creatorDiscount: 0, taxRate: 0 });
        expect(r.tax).toBe(0);
        expect(r.total).toBe(50);
    });

    it("clamps taxable + total to >= 0 when discounts exceed subtotal", () => {
        const r = computeTotals({ subtotal: 30, couponDiscount: 20, creatorDiscount: 25, taxRate: 10 });
        expect(r.totalDiscount).toBe(45);
        expect(r.taxableAmount).toBe(0);
        expect(r.tax).toBe(0);
        expect(r.total).toBe(0);
    });
});
