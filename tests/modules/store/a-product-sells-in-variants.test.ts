// @vitest-environment node
/**
 * A product can be sold in variants: a pack of three keys, a rank for six
 * months. The buyer pays the variant's price, the commands see the units it
 * delivers and the values the operator set for it, and the line keeps a copy
 * of it so a later edit does not rewrite what was sold.
 */
import { describe, it, expect } from "vitest";
import {
    chosenVariant,
    offeredVariantPrice,
    snapshotIn,
    snapshotOf,
    unitsDelivered,
    variablesWithVariant,
    variantLineName,
    variantSavings,
    variantsOf,
} from "@/modules/store/lib/variants";
import { computeOrderPricing } from "@/modules/store/lib/pricing";
import { stockClaims } from "@/modules/store/lib/stock";
import { chestFieldsFor } from "@/modules/store/lib/chest";

const keys = [
    { id: "one", label: "1x", price: 100, units: 1 },
    { id: "three", label: { default: "3x", tr: "3 adet" }, price: 270, units: 3, variables: { amount: "3" } },
    { id: "six", label: "6x", price: 510, units: 6, commands: [{ command: "key give {player} {amount}" }] },
    { id: "gone", label: "12x", price: 960, units: 12, isActive: false },
];

describe("a product's variants", () => {
    it("leave out an entry nobody could pay for", () => {
        const read = variantsOf([...keys, { id: "x", label: "", price: 5 }, { label: "y", price: 5 }, { id: "z", label: "z", price: "nope" }, null]);
        expect(read.map((v) => v.id)).toEqual(["one", "three", "six", "gone"]);
    });

    it("ask for one when the product offers any, and take none when it offers none", () => {
        expect(chosenVariant(keys, null)).toEqual({ ok: false, code: "store_variant_required" });
        expect(chosenVariant(keys, "gone")).toEqual({ ok: false, code: "store_variant_unavailable" });
        const picked = chosenVariant(keys, "three");
        expect(picked.ok && picked.variant?.price).toBe(270);
        expect(chosenVariant(null, null)).toEqual({ ok: true, variant: null });
        expect(chosenVariant([], "three")).toEqual({ ok: false, code: "store_variant_unavailable" });
    });

    it("take the same share off as the product's own offer", () => {
        expect(offeredVariantPrice(270, 100, 80)).toBe(216);
        expect(offeredVariantPrice(270, 100, 100)).toBe(270);
        expect(offeredVariantPrice(270, 0, 0)).toBe(270);
    });

    it("show a saving only where the price per unit really is lower", () => {
        const savings = variantSavings(variantsOf(keys).filter((v) => v.isActive), null);
        expect(savings.get("one")).toBe(0);
        expect(savings.get("three")).toBe(10);
        expect(savings.get("six")).toBe(15);
    });

    it("measure a timed variant per day", () => {
        const months = variantsOf([
            { id: "m1", label: "1", price: 500, durationDays: 30 },
            { id: "m2", label: "2", price: 850, durationDays: 60 },
        ]);
        expect(variantSavings(months, 30).get("m2")).toBe(15);
    });

    it("deliver the units of the pack and the operator's values over the buyer's", () => {
        const [, three] = variantsOf(keys);
        const kept = snapshotIn({ variant: snapshotOf(three, "tr") });
        expect(kept?.label).toBe("3 adet");
        expect(unitsDelivered(2, kept)).toBe(6);
        expect(unitsDelivered(2, null)).toBe(2);
        expect(variablesWithVariant({ amount: "999", note: "hi" }, three)).toEqual({ amount: "3", note: "hi" });
    });

    it("name the line with the variant in the buyer's language", () => {
        const [, three] = variantsOf(keys);
        expect(variantLineName("Ejder Anahtarı", three, "tr")).toBe("Ejder Anahtarı - 3 adet");
        expect(variantLineName("Ejder Anahtarı", three, "en")).toBe("Ejder Anahtarı - 3x");
        expect(variantLineName("Ejder Anahtarı", null, "en")).toBe("Ejder Anahtarı");
    });

    it("carry their own commands, read back from what the line kept", () => {
        const six = variantsOf(keys)[2];
        const kept = snapshotIn(snapshotOf(six, "en"));
        expect(kept?.commands).toEqual([{ command: "key give {player} {amount}", serverId: null, target: null, whenOnline: null }]);
    });
});

describe("a line bought as a variant", () => {
    const product = { id: "key", name: "Ejder Anahtarı", price: 80, listPrice: 100, categoryId: null, variants: keys };
    const price = (variantId: string | null, quantity = 1) =>
        computeOrderPricing({
            items: [{ productId: "key", quantity, variantId }],
            products: [product],
            bulkDiscounts: [],
            ownedProductIds: new Set(),
            ownedRungs: [],
            variables: { key: { amount: "999" } },
            locale: "tr",
        });

    it("is charged the variant's price under the product's offer, never the product's own", () => {
        const { orderItems, subtotal } = price("three", 2);
        expect(orderItems[0].price).toBe(216);
        expect(subtotal).toBe(432);
        expect(orderItems[0].name).toBe("Ejder Anahtarı - 3 adet");
        expect(orderItems[0].metadata.variables).toEqual({ amount: "3" });
        expect(orderItems[0].metadata.variant?.units).toBe(3);
    });

    it("is refused without a variant, or with one the product does not sell", () => {
        expect(() => price(null)).toThrow("store_variant_required");
        expect(() => price("gone")).toThrow("store_variant_unavailable");
    });

    it("takes the units it delivers off the shelf and into the chest", () => {
        const { orderItems } = price("six", 2);
        const line = { productId: "key", quantity: orderItems[0].quantity, metadata: orderItems[0].metadata };
        expect(stockClaims([line])).toEqual([{ productId: "key", quantity: 12 }]);
        const chest = chestFieldsFor(line);
        expect(chest.quantity).toBe(12);
        expect(snapshotIn(chest.variant)?.commands[0]?.command).toBe("key give {player} {amount}");
    });

    it("leaves a product without variants exactly as it was", () => {
        const plain = computeOrderPricing({
            items: [{ productId: "p", quantity: 2 }],
            products: [{ id: "p", name: "Plain", price: 10, categoryId: null }],
            bulkDiscounts: [],
            ownedProductIds: new Set(),
            ownedRungs: [],
        });
        expect(plain.orderItems[0]).toMatchObject({ name: "Plain", price: 10, quantity: 2, metadata: { variables: {} } });
        expect(plain.orderItems[0].metadata.variant).toBeUndefined();
        expect(stockClaims([{ productId: "p", quantity: 2, metadata: plain.orderItems[0].metadata }])).toEqual([{ productId: "p", quantity: 2 }]);
    });
});
