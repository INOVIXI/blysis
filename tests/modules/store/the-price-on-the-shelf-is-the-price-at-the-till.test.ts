/**
 * What a shelf quotes is what the till takes.
 *
 * The upgrade credit is worked out against a ladder: the rungs of the shelf a
 * product stands on. Three screens build that ladder from the shelf - the
 * listing, the product page and the comparison table - and they quote 10.00
 * to somebody who owns VIP and is looking at VIP+.
 *
 * The cart, the coupon preview and the checkout built it from the basket
 * instead, and the rung somebody already owns is exactly the thing that is not
 * in their basket. So the credit could only ever fire when a buyer had put the
 * product they already own into the basket alongside the one above it, which
 * is not what an upgrade is. Measured on 2026-09-20 against the demo shop: the
 * shelf and the comparison table said 10.00 for a VIP owner, and both the cart
 * endpoint and `computeOrderPricing` said 19.99.
 *
 * A shop that advertises 10.00 and charges 19.99 is worse than one that never
 * offered the credit. The rungs a buyer stands on are passed in now, and they
 * are a required argument rather than a default, because the way this broke
 * was a caller not knowing there was a ladder to pass.
 */
import { describe, it, expect } from "vitest";
import { priceCartLines } from "@/modules/store/lib/cart-pricing";
import { computeOrderPricing } from "@/modules/store/lib/pricing";

/** The rung this buyer already stands on. It is not in their basket. */
const VIP = { id: "vip", categoryId: "ranks", price: 9.99 };
const VIP_PLUS = { id: "vip-plus", categoryId: "ranks", price: 19.99 };
const OWNS_VIP = new Set(["vip"]);

describe("a basket holding the rung above the one already owned", () => {
    it("is priced at the difference by the cart", () => {
        const { lines, subtotal } = priceCartLines(
            [{ productId: VIP_PLUS.id, categoryId: VIP_PLUS.categoryId, price: VIP_PLUS.price, quantity: 1 }],
            OWNS_VIP,
            [VIP],
        );

        expect(lines[0].upgradeCredit).toBe(9.99);
        expect(lines[0].payPrice).toBeCloseTo(10, 5);
        expect(subtotal).toBeCloseTo(10, 5);
    });

    it("is charged the difference by the till", () => {
        const { subtotal, orderItems } = computeOrderPricing({
            items: [{ productId: VIP_PLUS.id, quantity: 1 }],
            products: [{ id: VIP_PLUS.id, name: "VIP+", type: "DIGITAL", price: VIP_PLUS.price, categoryId: "ranks" }],
            bulkDiscounts: [],
            ownedProductIds: OWNS_VIP,
            ownedRungs: [VIP],
        });

        expect(orderItems[0].price).toBeCloseTo(10, 5);
        expect(subtotal).toBeCloseTo(10, 5);
    });

    it("is quoted the same number by both", () => {
        const cart = priceCartLines(
            [{ productId: VIP_PLUS.id, categoryId: VIP_PLUS.categoryId, price: VIP_PLUS.price, quantity: 1 }],
            OWNS_VIP,
            [VIP],
        );
        const till = computeOrderPricing({
            items: [{ productId: VIP_PLUS.id, quantity: 1 }],
            products: [{ id: VIP_PLUS.id, name: "VIP+", type: "DIGITAL", price: VIP_PLUS.price, categoryId: "ranks" }],
            bulkDiscounts: [],
            ownedProductIds: OWNS_VIP,
            ownedRungs: [VIP],
        });

        expect(cart.subtotal).toBeCloseTo(till.subtotal, 5);
    });
});

describe("a buyer who stands on no rung", () => {
    it("pays the full price in the cart", () => {
        const { subtotal } = priceCartLines(
            [{ productId: VIP_PLUS.id, categoryId: VIP_PLUS.categoryId, price: VIP_PLUS.price, quantity: 1 }],
            new Set(),
            [],
        );

        expect(subtotal).toBeCloseTo(19.99, 5);
    });

    it("pays the full price at the till", () => {
        const { subtotal } = computeOrderPricing({
            items: [{ productId: VIP_PLUS.id, quantity: 1 }],
            products: [{ id: VIP_PLUS.id, name: "VIP+", type: "DIGITAL", price: VIP_PLUS.price, categoryId: "ranks" }],
            bulkDiscounts: [],
            ownedProductIds: new Set(),
            ownedRungs: [],
        });

        expect(subtotal).toBeCloseTo(19.99, 5);
    });
});

describe("what the cart hands on to a coupon", () => {
    it("is an exact number of cents, not what the subtraction produced", () => {
        // 19.99 less 9.99 is 9.999999999999998 in binary floating point. The
        // cart returned that as its subtotal and the coupon preview checks a
        // minimum purchase against it, so a basket worth exactly ten was
        // refused a coupon asking for ten. The existing cents gate does not
        // see this: its tolerance is 1e-9 and the dust is 1e-13. The
        // comparison is what fails, so equality is what this asserts.
        const { subtotal } = priceCartLines(
            [{ productId: VIP_PLUS.id, categoryId: VIP_PLUS.categoryId, price: VIP_PLUS.price, quantity: 1 }],
            OWNS_VIP,
            [VIP],
        );

        expect(subtotal).toBe(10);
        expect(subtotal >= 10).toBe(true);
    });
});

describe("a rung on another shelf", () => {
    it("credits nothing, wherever it is passed from", () => {
        const KEY = { id: "key", categoryId: "crate-keys", price: 4.99 };

        const { subtotal } = priceCartLines(
            [{ productId: VIP_PLUS.id, categoryId: VIP_PLUS.categoryId, price: VIP_PLUS.price, quantity: 1 }],
            new Set(["key"]),
            [KEY],
        );

        expect(subtotal).toBeCloseTo(19.99, 5);
    });
});
