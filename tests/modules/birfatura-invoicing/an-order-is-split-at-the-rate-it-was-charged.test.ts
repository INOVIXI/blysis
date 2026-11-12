// @vitest-environment node
/**
 * An order is split at the rate it was charged, not at today's shop rate.
 *
 * The answer used to read the store's one tax setting for every order. With
 * a tax module a sale to a buyer abroad can be zero-rated as an export, or
 * charged another country's rate, and the order keeps what it was charged
 * under `metadata.tax`. Splitting that order at the shop's domestic rate puts
 * tax on a legal document that the buyer never paid - and, for an export, a
 * domestic rate on a sale that is exempt. An order placed before there was a
 * record still splits at the shop's setting, which is all there is for it.
 */
import { describe, expect, it } from "vitest";
import { orderAnswer } from "../../../module-sources/birfatura-invoicing/lib/order-answer";

const SHOP = { timeZone: "Europe/Istanbul", taxRate: 20, taxIncluded: true };

const ORDER = {
    id: "o1",
    number: 7,
    orderNumber: "ORD-7",
    createdAt: new Date("2026-11-01T10:00:00.000Z"),
    currency: "EUR",
    total: 100,
    subtotal: 100,
    discount: 0,
    userId: "u1",
    email: "buyer@example.com",
    paymentMethod: "stripe",
    billingDetails: { kind: "individual", name: "Ada", phone: "", taxNumber: "", taxOffice: "", address: "1 Rue", city: "Paris", country: "FR" },
    items: [{ productId: "p1", name: "Rank", quantity: 1, price: 100 }],
};

const recorded = (tax: Record<string, unknown>) => ({ ...ORDER, metadata: { playerName: "Steve", tax } });
const line = (answer: Record<string, unknown> | null) => (answer?.OrderDetails as Record<string, unknown>[])[0];

describe("an order with a recorded tax", () => {
    it("carries no tax when it was zero-rated as an export", () => {
        const answer = orderAnswer(
            recorded({ rate: 0, included: true, label: { kind: "preset", id: "vat" }, reason: "export", country: "US" }),
            SHOP,
        );
        expect(line(answer)).toMatchObject({ VatRate: 0, ProductUnitPriceTaxExcluding: 100, ProductUnitPriceTaxIncluding: 100 });
        expect(answer).toMatchObject({ TotalPaidTaxExcluding: 100, TotalPaidTaxIncluding: 100, Currency: "EUR" });
    });

    it("splits at the rate the buyer's country was charged", () => {
        const answer = orderAnswer(
            recorded({ rate: 5.5, included: false, label: { kind: "preset", id: "vat" }, reason: "destination", country: "FR" }),
            SHOP,
        );
        expect(line(answer)).toMatchObject({ VatRate: 5.5, ProductUnitPriceTaxExcluding: 100, ProductUnitPriceTaxIncluding: 105.5 });
    });

    it("splits an order from before there was a record at the shop's setting", () => {
        expect(line(orderAnswer(ORDER, SHOP))).toMatchObject({ VatRate: 20, ProductUnitPriceTaxIncluding: 100, ProductUnitPriceTaxExcluding: 83.33 });
    });

    it("ignores a record it cannot read rather than guessing from half of it", () => {
        expect(line(orderAnswer(recorded({ rate: "zero" }), SHOP))).toMatchObject({ VatRate: 20 });
    });
});
