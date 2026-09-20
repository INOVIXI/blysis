// @vitest-environment node
/**
 * A coupon says which products it works on, and says why when it does not.
 *
 * Every coupon applied to the whole basket. An operator wanting "20% off the
 * ranks this weekend" had no way to say it: the code came off the hats and
 * the gift cards too, and the only way to keep it to one shelf was to not
 * run the offer. The shape is the one `BulkDiscount` already uses - a product
 * or a category named on the row - widened to a list, because a coupon is a
 * marketing instrument and a one-product coupon is nearly useless. Nothing
 * named means every product, which is what every coupon written before this
 * meant.
 *
 * The minimum purchase is measured against the order and the discount against
 * the part of it the coupon covers. "Spend 50, get 20% off ranks" is one
 * sentence about two different numbers, and reading either against the wrong
 * one is a shop that overcharges or undercharges.
 *
 * And a refusal carries a code. `computeCouponDiscount` answered with English
 * sentences - "Coupon has expired", "Coupon requires a minimum purchase of
 * 50" - which two screens then threw away, because a shopper reading Turkish
 * cannot be shown them. The one reason a shopper can act on is the minimum,
 * and it was the one being discarded: the endpoint built it with a hardcoded
 * dollar sign on a site whose currency is an operator's choice.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
    computeCouponDiscount,
    couponEligibleSubtotal,
} from "@/modules/store/lib/pricing";

const PRODUCTS = [
    { id: "rank-vip", name: "VIP", price: 40, categoryId: "ranks" },
    { id: "rank-mvp", name: "MVP", price: 60, categoryId: "ranks" },
    { id: "hat", name: "Hat", price: 10, categoryId: "cosmetics" },
];

const BASKET = [
    { productId: "rank-vip", price: 40, quantity: 1 },
    { productId: "hat", price: 10, quantity: 2 },
];

const LIVE = { isActive: true, type: "PERCENTAGE", value: 50 };

describe("what a coupon covers", () => {
    it("is the whole basket when it names nothing", () => {
        expect(couponEligibleSubtotal({}, BASKET, PRODUCTS)).toBe(60);
    });

    it("is one category when it names one", () => {
        expect(couponEligibleSubtotal({ categoryIds: ["ranks"] }, BASKET, PRODUCTS)).toBe(40);
    });

    it("is one product when it names one", () => {
        expect(couponEligibleSubtotal({ productIds: ["hat"] }, BASKET, PRODUCTS)).toBe(20);
    });

    it("counts a line that matches either of them once", () => {
        expect(
            couponEligibleSubtotal({ productIds: ["hat"], categoryIds: ["cosmetics"] }, BASKET, PRODUCTS),
        ).toBe(20);
    });

    it("is nothing when the basket holds none of what it names", () => {
        expect(couponEligibleSubtotal({ categoryIds: ["keys"] }, BASKET, PRODUCTS)).toBe(0);
    });
});

describe("what a coupon takes off", () => {
    it("comes off the part it covers, not off the whole basket", () => {
        const priced = computeCouponDiscount(LIVE, 60, new Date(), 40);
        expect(priced.discount).toBe(20);
    });

    it("comes off everything when it covers everything", () => {
        expect(computeCouponDiscount(LIVE, 60, new Date(), 60).discount).toBe(30);
    });

    it("is refused when the basket holds nothing it covers", () => {
        const priced = computeCouponDiscount(LIVE, 60, new Date(), 0);
        expect(priced.discount).toBe(0);
        expect(priced.code).toBe("coupon_not_for_these_items");
    });

    it("reads the minimum against the order, not against the part it covers", () => {
        // Spend 50 on the shop, take 50% off the ranks. The basket is 60, so
        // the minimum is met; the ranks are 40, so the discount is 20.
        const priced = computeCouponDiscount({ ...LIVE, minPurchase: 50 }, 60, new Date(), 40);
        expect(priced.code).toBeNull();
        expect(priced.discount).toBe(20);
    });
});

describe("why a coupon was refused", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    const cases: [string, Parameters<typeof computeCouponDiscount>[0], string][] = [
        ["off", { ...LIVE, isActive: false }, "coupon_unknown"],
        ["not started", { ...LIVE, startsAt: new Date("2026-10-01") }, "coupon_not_started"],
        ["expired", { ...LIVE, expiresAt: new Date("2026-01-01") }, "coupon_expired"],
        ["used up", { ...LIVE, usageLimit: 1, usageCount: 1 }, "coupon_used_up"],
        ["under the minimum", { ...LIVE, minPurchase: 100 }, "coupon_min_purchase"],
    ];

    for (const [what, coupon, code] of cases) {
        it(`is said as a code a screen can translate: ${what}`, () => {
            const priced = computeCouponDiscount(coupon, 60, now);
            expect(priced.discount).toBe(0);
            expect(priced.code).toBe(code);
        });
    }

    it("says nothing at all when the coupon works", () => {
        expect(computeCouponDiscount(LIVE, 60, now).code).toBeNull();
    });
});

describe("the screens either end of it", () => {
    const read = (rel: string) =>
        fs.readFileSync(path.join(process.cwd(), "module-sources/store", rel), "utf8");
    const manifest = () => JSON.parse(read("module.json"));

    it("asks for the shelf by name, not by id", () => {
        const form = read("pages/admin/coupons/page.tsx");
        expect(form).toContain("ReferenceList");
        expect(form).toContain("productIds");
        expect(form).toContain("categoryIds");
    });

    it("says the minimum in the money the shop charges in", () => {
        // It arrived as "Minimum purchase: $50.00" whatever the shop's
        // currency was, and the page discarded it unread.
        const cart = read("pages/public/cart/page.tsx");
        expect(cart).toContain("err_couponMinPurchase");
        expect(cart).toContain("formatPrice(data.minPurchase)");
        expect(read("api/coupons/validate/route.ts")).not.toContain("$${");
    });

    it("has a word for every refusal a shopper is told about, in both languages", () => {
        const translations = manifest().translations;
        for (const locale of ["en", "tr"]) {
            const store = translations[locale].store;
            expect(typeof store.err_couponMinPurchase, `${locale} err_couponMinPurchase`).toBe("string");
            for (const code of ["coupon_not_for_these_items", "coupon_used_up", "coupons_off"]) {
                expect(typeof store.err[code], `${locale} err.${code}`).toBe("string");
            }
        }
    });

    it("carries the shelf through the write schema", () => {
        const validations = read("lib/validations.ts");
        expect(validations).toContain("productIds");
        expect(validations).toContain("categoryIds");
    });

    it("arrives as a numbered migration, because this module has shipped", () => {
        const dir = path.join(process.cwd(), "module-sources/store/migrations");
        const sql = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"))
            .map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
        expect(sql).toContain('"productIds"');
        expect(sql).toContain('"categoryIds"');
    });
});
