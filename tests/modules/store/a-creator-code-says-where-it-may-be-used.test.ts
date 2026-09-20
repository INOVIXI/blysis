// @vitest-environment node
/**
 * A creator code says where it may be used, and the basket says whether it
 * was.
 *
 * A code took its percentage off the whole basket, whatever was in it. An
 * operator running a code for one creator's own cosmetic line had no way to
 * say so: the code came off the ranks, the keys and the gift cards too, and
 * the commission followed the same number. Two lists now, the same shape the
 * coupon and the bulk discount carry, matched by the same function.
 *
 * It also never discounts money the coupon has already taken. The creator's
 * cut is a percentage of the part the code covers, and the part it covers
 * cannot be larger than what is left of the basket after the coupon - a
 * hundred-percent coupon and a five-percent code on the same basket used to
 * take five percent of nothing and still write a commission for it.
 *
 * And the browser stopped working out the number: the basket used to compute
 * `(total - coupon) * percent / 100` itself, which is a second answer to a
 * question the till already answers, and with a scope it is the wrong one.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeCreatorDiscount, scopedSubtotal } from "@/modules/store/lib/pricing";
import { stripComments } from "../../unit/source-text";

const PRODUCTS = [
    { id: "vip", categoryId: "ranks" },
    { id: "hat", categoryId: "cosmetics" },
];
const BASKET = [
    { productId: "vip", price: 40, quantity: 1 },
    { productId: "hat", price: 10, quantity: 2 },
];

describe("what a code covers", () => {
    it("is the whole basket when it names nothing", () => {
        expect(scopedSubtotal({}, BASKET, PRODUCTS)).toBe(60);
    });

    it("is what it names", () => {
        expect(scopedSubtotal({ categoryIds: ["cosmetics"] }, BASKET, PRODUCTS)).toBe(20);
        expect(scopedSubtotal({ productIds: ["vip"] }, BASKET, PRODUCTS)).toBe(40);
    });
});

describe("what a creator code takes off", () => {
    it("is its percentage of the whole basket when it covers all of it", () => {
        expect(computeCreatorDiscount(60, 0, 10)).toBe(6);
    });

    it("comes off after the coupon, as it always did", () => {
        expect(computeCreatorDiscount(60, 20, 10)).toBe(4);
    });

    it("is its percentage of the part it covers, not of the basket", () => {
        expect(computeCreatorDiscount(60, 0, 10, 20)).toBe(2);
    });

    it("never discounts money the coupon has already taken", () => {
        // A coupon that emptied the basket leaves nothing for the code, even
        // where the code covers everything.
        expect(computeCreatorDiscount(60, 60, 10, 60)).toBe(0);
        // And the covered part is clamped to what is left, not to itself.
        expect(computeCreatorDiscount(60, 50, 10, 40)).toBe(1);
    });

    it("is nothing where the basket holds none of what it covers", () => {
        expect(computeCreatorDiscount(60, 0, 10, 0)).toBe(0);
    });
});

describe("the screens either end of it", () => {
    const read = (rel: string) =>
        fs.readFileSync(path.join(process.cwd(), "module-sources/store", rel), "utf8");
    const manifest = () => JSON.parse(read("module.json"));

    it("asks for the shelf by name, and for as many as the code covers", () => {
        const form = read("pages/admin/creator-codes/page.tsx");
        expect(form).toContain("referenceList");
        expect(form).toContain("productIds");
        expect(form).toContain("categoryIds");
    });

    it("says what a row is worth in words somebody wrote", () => {
        // The row read "5% off, 5% commission", in English, in the source.
        // Read with the comments taken out: the note explaining the fix
        // quotes the string it replaced, and a scan that reads comments finds
        // its own haystack.
        const form = stripComments(read("pages/admin/creator-codes/page.tsx"));
        expect(form).not.toContain("% off");
        expect(form).not.toContain("% commission");
        expect(form).toContain("cc_rowSummary");
    });

    it("writes the switch the form has always drawn", () => {
        expect(read("api/creator-codes/route.ts")).toContain("isActive: isActive ?? true");
    });

    it("lets the till work out the discount, not the browser", () => {
        const cart = read("pages/public/cart/page.tsx");
        expect(cart).not.toContain("creatorApplied.discountPercent / 100");
    });

    it("has a word for the refusal in both languages", () => {
        const translations = manifest().translations;
        for (const locale of ["en", "tr"]) {
            expect(typeof translations[locale].store.err.creator_not_for_these_items,
                `${locale} err.creator_not_for_these_items`).toBe("string");
        }
    });

    it("arrives as a numbered migration, because this module has shipped", () => {
        const dir = path.join(process.cwd(), "module-sources/store/migrations");
        const sql = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"))
            .map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
        expect(sql).toContain('"CreatorCode" ADD COLUMN IF NOT EXISTS "productIds"');
    });
});
