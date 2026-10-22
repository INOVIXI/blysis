/**
 * A settlement pays for what the store charged, or it settles nothing.
 *
 * The store took a gateway's word for how much had arrived. A CoinPayments
 * checkout link carried its amount where the buyer could edit it, so a cent
 * settled an order of fifty, and nothing on the store's side noticed: it had
 * never written down what it asked for. It does now, and each settlement is
 * held against that.
 *
 * Paying more is not refused. A buyer who picks instalments pays the bank's
 * interest on top, and the order is still paid for.
 */
import { describe, it, expect } from "vitest";
import { chargeShortfall } from "@/modules/store/lib/charge";

const charge = { amount: 49.99, currency: "USD" };

describe("a settlement held against its charge", () => {
    it("pays for it when the amount and the currency are the ones charged", () => {
        expect(chargeShortfall(charge, { amount: 49.99, currency: "USD" })).toBeNull();
    });

    it("pays for it when more arrived than was charged", () => {
        expect(chargeShortfall(charge, { amount: 52.4, currency: "USD" })).toBeNull();
    });

    it("does not when less arrived", () => {
        expect(chargeShortfall(charge, { amount: 0.01, currency: "USD" })).toMatch(/0\.01/);
        expect(chargeShortfall(charge, { amount: 49.98, currency: "USD" })).not.toBeNull();
    });

    it("does not when it arrived in another currency", () => {
        expect(chargeShortfall(charge, { amount: 49.99, currency: "TRY" })).toMatch(/TRY/);
    });

    it("reads the currency in whatever case the gateway wrote it", () => {
        expect(chargeShortfall(charge, { amount: 49.99, currency: "usd" })).toBeNull();
    });

    it("compares cents, not the float a gateway's arithmetic produced", () => {
        expect(chargeShortfall({ amount: 10.1, currency: "EUR" }, { amount: 10.099999999, currency: "EUR" })).toBeNull();
    });

    it("does not when the amount is not a number at all", () => {
        expect(chargeShortfall(charge, { amount: Number.NaN, currency: "USD" })).not.toBeNull();
    });

    // A provider that does not report the amount is one whose gateway fixed it
    // when the payment started: Paymentwall's widget URL is signed, and its
    // pingback carries no amount.
    it("takes as reported what the provider does not report", () => {
        expect(chargeShortfall(charge, { amount: null, currency: "USD" })).toBeNull();
        expect(chargeShortfall(charge, { amount: 49.99, currency: null })).toBeNull();
    });
});
