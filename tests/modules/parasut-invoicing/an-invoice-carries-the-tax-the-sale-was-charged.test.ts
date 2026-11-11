// @vitest-environment node
/**
 * An invoice carries the tax the sale was charged, and a sale charged none is
 * left for a person before a legal document goes out.
 *
 * Every invoice used to carry the store's one rate. With a tax module, a sale
 * to a buyer abroad can be zero-rated as an export or reverse-charged, and
 * the order records the rate and the reason under `metadata.tax`. Issuing it
 * at the shop's domestic rate is a document charging tax nobody paid. And a
 * zero-rated document goes to the authority with an exemption code this
 * module does not choose: which code applies is the operator's call, so an
 * automatic send waits for them instead of sending one that will be refused
 * or, worse, accepted with the wrong reason.
 */
import { describe, expect, it } from "vitest";
import { invoiceRate, recordedTax, sendsByItself } from "../../../module-sources/parasut-invoicing/lib/recorded-tax";
import { invoicePayload } from "../../../module-sources/parasut-invoicing/lib/invoice-payload";

const record = (tax: Record<string, unknown>) => ({ playerName: "Steve", tax });

describe("the rate on the invoice", () => {
    it("is the rate the order was charged", () => {
        expect(invoiceRate(recordedTax(record({ rate: 0, reason: "export", country: "US" })), 20)).toBe(0);
        expect(invoiceRate(recordedTax(record({ rate: 21, reason: "destination", country: "NL" })), 20)).toBe(21);
    });

    it("is the shop's setting for an order from before orders kept their own", () => {
        expect(invoiceRate(recordedTax({ playerName: "Steve" }), 20)).toBe(20);
        expect(invoiceRate(recordedTax(null), 20)).toBe(20);
        expect(invoiceRate(recordedTax(record({ rate: "twenty" })), 20)).toBe(20);
    });

    it("goes on every line of the document", () => {
        const payload = invoicePayload({
            contactId: "c1",
            order: { orderNumber: "ORD-1", currency: "EUR", taxRate: invoiceRate(recordedTax(record({ rate: 0, reason: "export" })), 20), lines: [{ name: "Rank", quantity: 1, unitAmount: 100 }] },
            issuedOn: new Date("2026-11-01T00:00:00Z"),
        });
        expect(payload.data.relationships.details.data[0].attributes.vat_rate).toBe(0);
        expect(payload.data.attributes.currency).toBe("EUR");
    });
});

describe("sending the legal document by itself", () => {
    it("goes ahead for a sale that carried tax, or one from before there was a record", () => {
        expect(sendsByItself(recordedTax(record({ rate: 20, reason: "domestic" })))).toBe(true);
        expect(sendsByItself(null)).toBe(true);
    });

    it("waits for a person on a sale that carried none", () => {
        expect(sendsByItself(recordedTax(record({ rate: 0, reason: "export" })))).toBe(false);
        expect(sendsByItself(recordedTax(record({ rate: 0, reason: "reverse_charge" })))).toBe(false);
        expect(sendsByItself(recordedTax(record({ rate: 0, reason: "exempt" })))).toBe(false);
    });
});
