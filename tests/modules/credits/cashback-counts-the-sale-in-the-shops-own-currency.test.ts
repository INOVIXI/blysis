/**
 * Cashback is a percentage of the sale in the shop's own currency.
 *
 * Credits are priced in the shop's base currency. The award took the order's
 * total as it stood, so on a shop priced in dollars an order paid in lira
 * earned credits as if every lira were a dollar: 1,500 TRY at 5% paid 75
 * credits where about 1.5 were due. The total is now turned into the base
 * currency first, and a sale with no rate on file earns nothing rather than a
 * guess.
 */
import { describe, it, expect } from "vitest";
import { cashbackFor, saleInBase } from "@/modules/credits/lib/cashback";

describe("the sale cashback is a percentage of", () => {
    it("is the total itself when the order was paid in the base currency", () => {
        expect(saleInBase({ total: "100", currency: "USD" }, "USD", null)).toBe(100);
    });

    it("is the total turned into the base currency when it was paid in another", () => {
        // 51 TRY to the dollar: the rate from TRY into USD is 1/51.
        expect(saleInBase({ total: "1530", currency: "TRY" }, "USD", 1 / 51)).toBeCloseTo(30, 6);
    });

    it("is nothing when there is no rate for the currency it was paid in", () => {
        expect(saleInBase({ total: "1530", currency: "TRY" }, "USD", null)).toBeNull();
    });

    it("is the total when the order does not say its currency", () => {
        expect(saleInBase({ total: "40", currency: null }, "USD", null)).toBe(40);
    });

    it("pays 5% of the converted sale, not of the lira figure", () => {
        const sale = saleInBase({ total: "1530", currency: "TRY" }, "USD", 1 / 51);
        expect(cashbackFor({ total: sale, paymentMethod: "paytr" }, 5)).toEqual({ award: 1 });
    });
});
