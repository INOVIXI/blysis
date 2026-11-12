/**
 * Every payment method can pass its fee on, not only the one that offered to.
 *
 * Only Stripe could say what it costs: the store took a fee from whatever a
 * gateway declared, and every other gateway declared nothing, so a shop
 * paying 3.5 per cent and a flat 0.25 to PayPal, or a local processor's 2.49
 * and a fixed fee in its own currency, swallowed it on every order. The
 * operator now writes a fee for any installed method in the store's own table.
 *
 * Three rules are pinned here. The operator's row wins over the gateway's own
 * offer, and a row switched off means no fee even where the gateway offers
 * one: an operator who looked at the method and said no has answered. A
 * method with no row keeps the gateway's offer, which is how a Stripe site
 * that set its fee before the table existed keeps charging it. And a fixed
 * part in another currency is converted into the order's before the charge is
 * grossed up, or refused when no rate exists, because a flat 0.30 USD charged
 * as 0.30 TRY is a fee nobody chose.
 */
import { describe, it, expect } from "vitest";
import { feeRuleFor, feeInOrderCurrency, readFeeTable } from "@/modules/store/lib/payment-fee";
import { grossUpForFee } from "@/modules/store/lib/pricing";

describe("which fee a payment method carries", () => {
    it("takes the operator's row over what the gateway offers", () => {
        const rule = feeRuleFor(
            { passOn: true, percent: 3.5, fixed: 0.25, fixedCurrency: "EUR" },
            { percent: 2.9, fixed: 0.3 },
        );
        expect(rule).toEqual({ percent: 3.5, fixed: 0.25, fixedCurrency: "EUR", source: "store" });
    });

    it("charges no fee where the operator switched the method's fee off, whatever the gateway offers", () => {
        expect(feeRuleFor({ passOn: false, percent: 3.5, fixed: 0.25, fixedCurrency: null }, { percent: 2.9, fixed: 0.3 })).toBeNull();
    });

    it("keeps a gateway's own offer for a method the operator has not set, in the order's currency", () => {
        // How a Stripe site that set its fee on Stripe's screen keeps it.
        expect(feeRuleFor(null, { percent: 2.9, fixed: 0.3 })).toEqual({
            percent: 2.9,
            fixed: 0.3,
            fixedCurrency: null,
            source: "gateway",
        });
    });

    it("charges nothing for a method with neither", () => {
        expect(feeRuleFor(null, undefined)).toBeNull();
    });

    it("treats a row of nothing as no fee, not a line reading 0.00", () => {
        expect(feeRuleFor({ passOn: true, percent: 0, fixed: 0, fixedCurrency: null }, undefined)).toBeNull();
    });

    it("ignores a negative or non-numeric figure rather than paying the buyer", () => {
        expect(feeRuleFor({ passOn: true, percent: -2, fixed: Number.NaN, fixedCurrency: null }, undefined)).toBeNull();
        expect(feeRuleFor({ passOn: true, percent: 2, fixed: -1, fixedCurrency: null }, undefined)).toEqual({
            percent: 2,
            fixed: 0,
            fixedCurrency: null,
            source: "store",
        });
    });
});

describe("a fixed fee in another currency", () => {
    it("needs no rate when it is already in the order's currency", () => {
        expect(feeInOrderCurrency({ percent: 2, fixed: 0.3, fixedCurrency: "usd" }, "USD", null)).toEqual({
            ok: true,
            fee: { percent: 2, fixed: 0.3 },
        });
        expect(feeInOrderCurrency({ percent: 2, fixed: 0.3, fixedCurrency: null }, "EUR", null)).toEqual({
            ok: true,
            fee: { percent: 2, fixed: 0.3 },
        });
    });

    it("is converted into the order's currency at the rate it is given", () => {
        // 0.30 USD in a shop pricing in TRY at 34.5 is 10.35.
        expect(feeInOrderCurrency({ percent: 2, fixed: 0.3, fixedCurrency: "USD" }, "TRY", 34.5)).toEqual({
            ok: true,
            fee: { percent: 2, fixed: 10.35 },
        });
    });

    it("is refused rather than guessed when there is no rate", () => {
        expect(feeInOrderCurrency({ percent: 2, fixed: 0.3, fixedCurrency: "USD" }, "TRY", null)).toEqual({ ok: false });
        expect(feeInOrderCurrency({ percent: 2, fixed: 0.3, fixedCurrency: "USD" }, "TRY", 0)).toEqual({ ok: false });
    });

    it("needs no rate for a percentage with no fixed part", () => {
        expect(feeInOrderCurrency({ percent: 2, fixed: 0, fixedCurrency: "USD" }, "TRY", null)).toEqual({
            ok: true,
            fee: { percent: 2, fixed: 0 },
        });
    });

    it("leaves the shop whole once grossed up with the converted figure", () => {
        const converted = feeInOrderCurrency({ percent: 2.9, fixed: 0.3, fixedCurrency: "USD" }, "EUR", 0.92);
        expect(converted.ok).toBe(true);
        if (!converted.ok || !converted.fee) return;
        const { charged, surcharge } = grossUpForFee(100, converted.fee);
        // 0.30 USD is 0.28 EUR; (100 + 0.28) / 0.971 = 103.27.
        expect(charged).toBe(103.27);
        expect(surcharge).toBe(3.27);
        const kept = charged * (1 - 0.029) - 0.3 * 0.92;
        expect(kept).toBeGreaterThanOrEqual(99.995);
    });
});

describe("the stored table", () => {
    it("reads each provider's row and drops what it cannot use", () => {
        const table = readFeeTable({
            paypal: { passOn: true, percent: 3.49, fixed: 0.49, fixedCurrency: "usd" },
            broken: "nonsense",
            iyzico: { passOn: true, percent: "2.5", fixed: null },
        });
        expect(table.paypal).toEqual({ passOn: true, percent: 3.49, fixed: 0.49, fixedCurrency: "USD" });
        expect(table.iyzico).toEqual({ passOn: true, percent: 2.5, fixed: 0, fixedCurrency: null });
        expect(table.broken).toBeUndefined();
    });

    it("is empty for a shop that never saved one", () => {
        expect(readFeeTable(null)).toEqual({});
        expect(readFeeTable([1, 2])).toEqual({});
    });
});
