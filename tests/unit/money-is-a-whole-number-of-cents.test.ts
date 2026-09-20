/**
 * No amount the store computes may be a fraction of a cent.
 *
 * A percentage produces one at the first opportunity: 33% off 9.99 is 6.6933.
 * Nothing downstream used to round it, so an order was stored at 6.6933 while
 * the receipt said 6.69, and each gateway rounded on its own terms - Stripe
 * per line item, iyzico and PayPal with toFixed(2), PayTR on the total. One
 * checkout of three at 9.99 with a 33% bulk tier, a 15% coupon, a 5% creator
 * code and 8% tax recorded 17.51451925 and told Stripe to charge 17.50.
 *
 * The fix was to round inside the pricing math itself, so every consumer
 * receives whole cents and its own rounding is a no-op. This gate holds that:
 * it sweeps the awkward prices and percentages rather than re-testing the one
 * combination that exposed it, because the next fractional amount will come
 * from a combination nobody wrote down.
 */
import { describe, it, expect } from "vitest";
import {
    computeOrderPricing,
    computeCouponDiscount,
    computeCreatorDiscount,
    computeCreatorCommission,
    computeTotals,
} from "../../module-sources/store/lib/pricing";

/** True when `amount` is a whole number of cents, allowing for float dust. */
const whole = (amount: number) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-9;

const PRICES = [0.01, 0.07, 4.99, 9.99, 19.95, 33.33, 149.99];
const PERCENTS = [0, 3, 7, 15, 33, 50, 66, 99];
const QUANTITIES = [1, 2, 3, 7, 13];

describe("every amount the store computes is a whole number of cents", () => {
    it("holds across prices, bulk tiers and quantities", () => {
        const bad: string[] = [];
        for (const price of PRICES) {
            for (const percent of PERCENTS) {
                for (const quantity of QUANTITIES) {
                    const { subtotal, orderItems } = computeOrderPricing({
                        items: [{ productId: "p", quantity }],
                        products: [{ id: "p", name: "Rank", price }],
                        bulkDiscounts: percent ? [{ minQuantity: 1, discountPercent: percent }] : [],
                        ownedProductIds: new Set(),
                        // Nothing owned off the basket: these are not about the upgrade credit.
                        ownedRungs: [],
                    });
                    if (!whole(orderItems[0].price)) bad.push(`unit ${price}/${percent}% = ${orderItems[0].price}`);
                    if (!whole(subtotal)) bad.push(`subtotal ${price}/${percent}%/x${quantity} = ${subtotal}`);
                }
            }
        }
        expect(bad).toEqual([]);
    });

    it("holds for an upgrade credit, which subtracts one fractional price from another", () => {
        const { subtotal, orderItems } = computeOrderPricing({
            items: [{ productId: "gold", quantity: 3 }],
            products: [
                { id: "gold", name: "Gold", price: 149.99, categoryId: "ranks" },
                { id: "silver", name: "Silver", price: 33.33, categoryId: "ranks" },
            ],
            bulkDiscounts: [{ minQuantity: 2, discountPercent: 7 }],
            ownedProductIds: new Set(["silver"]),
            // Nothing owned off the basket: these are not about the upgrade credit.
            ownedRungs: [],
        });
        expect(whole(orderItems[0].price)).toBe(true);
        expect(whole(subtotal)).toBe(true);
    });

    it("holds for the whole discount-and-tax roll-up", () => {
        const bad: string[] = [];
        for (const subtotal of [0.01, 20.07, 33.33, 149.99, 1234.56]) {
            for (const couponPercent of PERCENTS) {
                for (const creatorPercent of PERCENTS) {
                    for (const taxRate of [0, 7, 8, 19, 20]) {
                        const { discount } = computeCouponDiscount(
                            { isActive: true, type: "PERCENTAGE", value: couponPercent },
                            subtotal,
                        );
                        const creator = computeCreatorDiscount(subtotal, discount, creatorPercent);
                        const totals = computeTotals({
                            subtotal,
                            couponDiscount: discount,
                            creatorDiscount: creator,
                            taxRate,
                        });
                        const where = `${subtotal}/${couponPercent}%/${creatorPercent}%/${taxRate}%`;
                        for (const [name, amount] of [
                            ["coupon", discount],
                            ["creator", creator],
                            ["totalDiscount", totals.totalDiscount],
                            ["taxable", totals.taxableAmount],
                            ["tax", totals.tax],
                            ["total", totals.total],
                        ] as const) {
                            if (!whole(amount)) bad.push(`${name} ${where} = ${amount}`);
                        }
                    }
                }
            }
        }
        expect(bad).toEqual([]);
    });

    it("holds for a fixed-amount coupon, which the subtotal can clamp", () => {
        for (const value of [0.01, 5, 33.33, 1000]) {
            const { discount } = computeCouponDiscount(
                { isActive: true, type: "FIXED", value },
                20.07,
            );
            expect(whole(discount)).toBe(true);
        }
    });

    it("holds for a creator's commission, which is paid into a balance and ledgered", () => {
        const bad: string[] = [];
        for (const total of [0.01, 17.51, 20.07, 149.99, 1234.56]) {
            for (const percent of [1, 2.5, 7.5, 15, 33, 100]) {
                const commission = computeCreatorCommission(total, percent);
                if (!whole(commission)) bad.push(`${total} at ${percent}% = ${commission}`);
            }
        }
        expect(bad).toEqual([]);
    });

    it("charges what it records: gateway rounding is a no-op on these amounts", () => {
        // Stripe rounds each line and the coupon separately; the sum has to
        // land on the total the order was stored with.
        const { subtotal, orderItems } = computeOrderPricing({
            items: [{ productId: "p", quantity: 3 }],
            products: [{ id: "p", name: "Rank", price: 9.99 }],
            bulkDiscounts: [{ minQuantity: 3, discountPercent: 33 }],
            ownedProductIds: new Set(),
            // Nothing owned off the basket: these are not about the upgrade credit.
            ownedRungs: [],
        });
        const { discount } = computeCouponDiscount(
            { isActive: true, type: "PERCENTAGE", value: 15 },
            subtotal,
        );
        const creator = computeCreatorDiscount(subtotal, discount, 5);
        const { totalDiscount, tax, total } = computeTotals({
            subtotal,
            couponDiscount: discount,
            creatorDiscount: creator,
            taxRate: 8,
        });

        const lines = orderItems.reduce(
            (sum, item) => sum + Math.round(item.price * 100) * item.quantity,
            0,
        );
        const charged = lines + Math.round(tax * 100) - Math.round(Number(totalDiscount.toFixed(2)) * 100);
        expect(charged).toBe(Math.round(total * 100));
    });
});
