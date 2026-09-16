/**
 * Handing an order to a service that pulls, rather than one we push to.
 *
 * This integrator does not take invoices. It asks for orders: it calls the
 * shop on a schedule with a date window, gets a list back, and issues the
 * documents itself. So what this module ships is answers, and the whole of
 * its correctness is whether those answers describe the sale.
 *
 * It wants every price twice, once with tax and once without, and that is
 * where a shop gets it wrong. A shop that quotes tax-inclusive prices - which
 * is the law for a consumer sale in most of the places this is used - has
 * already got the tax inside the number on the page. Multiplying it up again
 * puts a figure on a legal document that is higher than what the customer
 * paid. At twenty per cent the tax inside 120 is 20, not 24, and the six lira
 * of difference is exactly what a tax office checks.
 *
 * The store already knows which way it prices, and this reads that rather
 * than assuming: the same split the till used, or the invoice disagrees with
 * the card statement.
 */
import { describe, it, expect } from "vitest";
import { splitLine, orderAnswer } from "@/modules/birfatura-invoicing/lib/order-answer";
import { integerFor } from "@/modules/birfatura-invoicing/lib/integrator-ids";

describe("a line, split both ways", () => {
    it("adds the tax on when the shop quotes prices without it", () => {
        expect(splitLine(100, 20, false)).toEqual({ excluding: 100, including: 120 });
    });

    it("takes the tax out when the shop quotes prices with it already in", () => {
        // The trap. 120 gross at twenty per cent is 100 net, not 144.
        expect(splitLine(120, 20, true)).toEqual({ excluding: 100, including: 120 });
    });

    it("leaves a price alone when the shop charges no tax", () => {
        expect(splitLine(50, 0, false)).toEqual({ excluding: 50, including: 50 });
        expect(splitLine(50, 0, true)).toEqual({ excluding: 50, including: 50 });
    });

    it("answers in money, not in a float that drifted", () => {
        // 19.90 gross at 20 per cent is 16.5833... and the document says
        // 16.58, which is what the customer's receipt has to add up to.
        expect(splitLine(19.9, 20, true)).toEqual({ excluding: 16.58, including: 19.9 });
    });
});

describe("one order, as the integrator asks for it", () => {
    const order = {
        id: "order-1",
        // The integer the shop keeps for an integrator that can only hold one.
        number: 1042,
        orderNumber: "ORD-MHK2X9Q-A3F1",
        createdAt: new Date("2026-09-09T09:30:00Z"),
        currency: "TRY",
        total: 119.4,
        userId: "user-1",
        email: "buyer@example.com",
        paymentMethod: "manual-payment",
        billingDetails: {
            kind: "individual",
            name: "Ada Lovelace",
            taxNumber: "11111111111",
            taxOffice: "",
            address: "12 Analytical Street",
            city: "Istanbul",
            country: "TR",
        },
        items: [{ productId: "vip", name: "VIP", quantity: 2, price: 59.7 }],
    };

    const answer = orderAnswer(order, { taxRate: 20, taxIncluded: true, timeZone: "Europe/Istanbul" });

    it("is named by the number the buyer sees, not by a row id", () => {
        // `OrderCode` is what an accountant and a customer can both quote.
        // `OrderId` is the integer the document's schema asks for, and it is
        // the shop's own column rather than a cuid stringified into a field
        // that cannot hold one.
        expect(answer.OrderCode).toBe("ORD-MHK2X9Q-A3F1");
        expect(answer.OrderId).toBe(1042);
    });

    it("carries who it is billed to", () => {
        expect(answer.BillingName).toBe("Ada Lovelace");
        expect(answer.BillingAddress).toBe("12 Analytical Street");
        expect(answer.BillingCity).toBe("Istanbul");
        expect(answer.Email).toBe("buyer@example.com");
        expect(answer.SSNTCNo).toBe("11111111111");
    });

    it("carries every line with its tax rate and both prices", () => {
        expect(answer.OrderDetails).toEqual([
            {
                // An integer for the field that is declared as one, derived
                // from the product's own id so it never moves; the id itself
                // travels in `ProductCode`, which is a string.
                ProductId: integerFor("vip"),
                ProductCode: "vip",
                ProductName: "VIP",
                ProductQuantity: 2,
                // The unit the quantity is counted in, which the document
                // requires and has no default for.
                ProductQuantityType: "Adet",
                VatRate: 20,
                ProductUnitPriceTaxIncluding: 59.7,
                ProductUnitPriceTaxExcluding: 49.75,
            },
        ]);
    });

    it("totals the same way, so the document adds up to what was charged", () => {
        expect(answer.TotalPaidTaxIncluding).toBe(119.4);
        expect(answer.TotalPaidTaxExcluding).toBe(99.5);
    });

    it("says the currency the sale was in", () => {
        expect(answer.Currency).toBe("TRY");
    });

    it("dates the order the way the integrator reads a date", () => {
        // Its documentation asks for `dd.MM.yyyy HH:mm:ss`, in the shop's own
        // time zone. This answered with an ISO stamp, which is not that
        // format and not that clock: 09:30 UTC is half past noon in Istanbul.
        expect(answer.OrderDate).toBe("09.09.2026 12:30:00");
    });
});

describe("an order with nobody on it", () => {
    it("says so rather than inventing a name from the account", () => {
        // An invoice made out to a username is a wrong legal document, and
        // the integrator will happily issue it.
        const nameless = {
            id: "order-2",
            orderNumber: "ORD-2",
            createdAt: new Date("2026-09-09T09:30:00Z"),
            currency: "TRY",
            total: 10,
            userId: "user-1",
            email: "buyer@example.com",
            paymentMethod: "credits",
            billingDetails: null,
            items: [],
        };
        expect(orderAnswer(nameless, { taxRate: 20, taxIncluded: true, timeZone: "Europe/Istanbul" })).toBeNull();
    });
});
