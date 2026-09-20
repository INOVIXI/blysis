// @vitest-environment node
/**
 * A bulk discount says which shelf it is for, and says so to the shopper.
 *
 * Two things were wrong with it, and the second is the worse one.
 *
 * It could name one product or one category, the same wall coupons had: "buy
 * three of any rank and save 20%" was sayable, "any of these three ranks" was
 * not. The rule is the coupon's rule now, from one function, so the two
 * cannot drift.
 *
 * And nothing told a shopper it existed. The only reader of the table was the
 * checkout: the shelf, the product page and the cart all quoted the list
 * price, and the discount appeared for the first time on the receipt. A
 * discount nobody is told about sells nothing extra, which is the entire
 * purpose of one. The product page carries the ladder now, and the quantity
 * control quotes what the till will charge.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
    bulkLadder,
    bulkDiscountFor,
    scopeCoversLine,
    computeOrderPricing,
} from "@/modules/store/lib/pricing";

const RANKS = "ranks";
const VIP = { id: "vip", name: "VIP", price: 10, categoryId: RANKS };
const HAT = { id: "hat", name: "Hat", price: 4, categoryId: "cosmetics" };

describe("what a rule covers", () => {
    it("is everything when it names nothing", () => {
        expect(scopeCoversLine({}, "vip", RANKS)).toBe(true);
        expect(scopeCoversLine({}, "hat", "cosmetics")).toBe(true);
    });

    it("is the products it names", () => {
        expect(scopeCoversLine({ productIds: ["vip", "mvp"] }, "mvp", RANKS)).toBe(true);
        expect(scopeCoversLine({ productIds: ["vip", "mvp"] }, "hat", "cosmetics")).toBe(false);
    });

    it("is the categories it names", () => {
        expect(scopeCoversLine({ categoryIds: [RANKS] }, "mvp", RANKS)).toBe(true);
        expect(scopeCoversLine({ categoryIds: [RANKS] }, "hat", "cosmetics")).toBe(false);
    });

    it("covers a line named by either list", () => {
        const scope = { productIds: ["hat"], categoryIds: [RANKS] };
        expect(scopeCoversLine(scope, "hat", "cosmetics")).toBe(true);
        expect(scopeCoversLine(scope, "mvp", RANKS)).toBe(true);
        expect(scopeCoversLine(scope, "cape", "cosmetics")).toBe(false);
    });

    it("does not cover a line with no category when only categories are named", () => {
        expect(scopeCoversLine({ categoryIds: [RANKS] }, "loose", null)).toBe(false);
    });
});

describe("the ladder a product is on", () => {
    const RULES = [
        { name: "three", minQuantity: 3, discountPercent: 10, categoryIds: [RANKS] },
        { name: "five", minQuantity: 5, discountPercent: 20, categoryIds: [RANKS] },
        { name: "hats", minQuantity: 2, discountPercent: 50, productIds: ["hat"] },
        { name: "off", minQuantity: 2, discountPercent: 90, categoryIds: [RANKS], isActive: false },
    ];

    it("holds only the rungs that cover it, in the order a shopper climbs them", () => {
        expect(bulkLadder(RULES, VIP)).toEqual([
            { minQuantity: 3, discountPercent: 10 },
            { minQuantity: 5, discountPercent: 20 },
        ]);
    });

    it("leaves out a rule an operator has switched off", () => {
        expect(bulkLadder(RULES, VIP).some((rung) => rung.discountPercent === 90)).toBe(false);
    });

    it("is empty where no rule covers the product", () => {
        expect(bulkLadder(RULES, { id: "cape", name: "Cape", price: 1, categoryId: "cosmetics" })).toEqual([]);
    });

    it("keeps the better of two rungs asking the same quantity", () => {
        const both = [
            { name: "a", minQuantity: 3, discountPercent: 10, categoryIds: [RANKS] },
            { name: "b", minQuantity: 3, discountPercent: 25, productIds: ["vip"] },
        ];
        expect(bulkLadder(both, VIP)).toEqual([{ minQuantity: 3, discountPercent: 25 }]);
    });
});

describe("what a quantity earns", () => {
    const RULES = [
        { name: "three", minQuantity: 3, discountPercent: 10, categoryIds: [RANKS] },
        { name: "five", minQuantity: 5, discountPercent: 20, categoryIds: [RANKS] },
    ];

    it("is nothing below the first rung", () => {
        expect(bulkDiscountFor(RULES, VIP, 2)).toBe(0);
    });

    it("is the rung reached", () => {
        expect(bulkDiscountFor(RULES, VIP, 3)).toBe(10);
        expect(bulkDiscountFor(RULES, VIP, 4)).toBe(10);
    });

    it("is the best rung reached, not the first", () => {
        expect(bulkDiscountFor(RULES, VIP, 9)).toBe(20);
    });
});

describe("the till", () => {
    it("charges the same rung the product page quoted", () => {
        const rules = [{ name: "five", minQuantity: 5, discountPercent: 20, categoryIds: [RANKS] }];
        const quoted = bulkDiscountFor(rules, VIP, 5);
        const { subtotal, orderItems } = computeOrderPricing({
            items: [{ productId: "vip", quantity: 5 }],
            products: [VIP, HAT],
            bulkDiscounts: rules,
            ownedProductIds: new Set(),
        });
        expect(quoted).toBe(20);
        expect(orderItems[0].metadata.bulkDiscount).toBe(20);
        expect(subtotal).toBe(40);
    });

    it("leaves a line no rule covers alone", () => {
        const { subtotal } = computeOrderPricing({
            items: [{ productId: "hat", quantity: 5 }],
            products: [VIP, HAT],
            bulkDiscounts: [{ name: "five", minQuantity: 5, discountPercent: 20, categoryIds: [RANKS] }],
            ownedProductIds: new Set(),
        });
        expect(subtotal).toBe(20);
    });
});

describe("the screens either end of it", () => {
    const read = (rel: string) =>
        fs.readFileSync(path.join(process.cwd(), "module-sources/store", rel), "utf8");
    const manifest = () => JSON.parse(read("module.json"));

    it("asks for the shelf by name, and for as many as the offer covers", () => {
        const form = read("pages/admin/bulk-discounts/page.tsx");
        expect(form).toContain("referenceList");
        expect(form).toContain("productIds");
        expect(form).toContain("categoryIds");
        // The labels said "Product ID" on a screen that never took one.
        expect(form).not.toContain("bd_productIdLabel");
        expect(form).not.toContain("bd_categoryIdLabel");
    });

    it("tells the shopper before the receipt does", () => {
        const view = read("components/ProductView.tsx");
        expect(view).toContain("bulkLadderTitle");
        expect(view).toContain("bulkLadderRung");
        expect(view).toContain("bulkApplied");
        // Written by the server, so the page it sends already says it.
        expect(read("pages/public/product/[...params]/page.tsx")).toContain("readBulkLadder");
    });

    it("has a word for each of those in both languages", () => {
        const translations = manifest().translations;
        for (const locale of ["en", "tr"]) {
            const store = translations[locale].store;
            for (const key of [
                "bulkLadderTitle", "bulkLadderRung", "bulkApplied",
                "bd_productsLabel", "bd_categoriesLabel", "bd_scopeHint",
                "bd_scopeEverything", "bd_scopeCount",
            ]) {
                expect(typeof store[key], `${locale} ${key}`).toBe("string");
            }
        }
    });

    it("writes the switch the form has always drawn", () => {
        // The form offered Active and the create dropped it, so a rule
        // written switched off arrived switched on.
        expect(read("api/bulk-discounts/route.ts")).toContain("isActive: isActive ?? true");
    });

    it("arrives as a numbered migration, because this module has shipped", () => {
        const dir = path.join(process.cwd(), "module-sources/store/migrations");
        const sql = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"))
            .map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
        expect(sql).toContain('"BulkDiscount" ADD COLUMN IF NOT EXISTS "productIds"');
        // Nothing is lost: the old single columns are copied into the lists
        // before they go.
        expect(sql).toContain('SET "productIds" = ARRAY["productId"]');
    });
});
