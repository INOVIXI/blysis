// @vitest-environment node
import { describe, expect, it } from "vitest";
import { orderAnswer } from "../../../module-sources/birfatura-invoicing/lib/order-answer";
import { STATUS_IDS, integerFor, statusNameFor } from "../../../module-sources/birfatura-invoicing/lib/integrator-ids";

/**
 * The answer matches the schema the integrator published, field for field.
 *
 * This module was written without it. What it sent was a reasonable guess and
 * wrong in eight places, and every one of them fails silently: the integrator
 * takes the order, issues a legal document from it, and nobody finds out until
 * an accountant does.
 *
 *   OrderId          asked for an integer, got a cuid
 *   ProductId        asked for an integer, got a cuid
 *   PaymentTypeId    asked for the integer /api/paymentMethods published,
 *                    got the gateway's own name
 *   orderStatusId    asked for the integer /api/orderStatus published,
 *                    got the shop's enum name
 *   ProductQuantityType   missing
 *   ProductsTotal*        missing, so a discount could only be inferred
 *   DiscountTotal*        missing
 *   Shipping* and BillingMobilePhone   missing
 *
 * The three endpoints have to agree with each other as well as with the
 * document: the id in an order is the id the other two published, which is
 * what the last two tests here are for.
 */

const TAX = { timeZone: "Europe/Istanbul", taxRate: 20, taxIncluded: true };

const ORDER = {
    id: "cmty7svq5003ub8tigeytlwrw",
    number: 41591,
    orderNumber: "ORD202607160001",
    createdAt: new Date("2026-07-16T07:30:00.000Z"),
    currency: "try",
    total: 1200,
    subtotal: 1200,
    discount: 0,
    userId: "u1",
    email: "buyer@example.com",
    paymentMethod: "iyzico",
    billingDetails: {
        kind: "person",
        name: "Örnek Müşteri",
        phone: "05000000000",
        taxNumber: "11111111111",
        taxOffice: "Çankaya",
        address: "Örnek Mah. Örnek Cad. No:1",
        city: "Ankara",
        country: "TR",
    },
    items: [{ productId: "cmtyproduct001", name: "Örnek Ürün", quantity: 1, price: 1200 }],
};

/** Every key the published example carries, at the order level. */
const ORDER_KEYS = [
    "OrderId", "OrderCode", "OrderDate",
    "BillingName", "BillingAddress", "BillingTown", "BillingCity", "BillingMobilePhone",
    "ShippingName", "ShippingAddress", "ShippingTown", "ShippingCity",
    "PaymentTypeId", "Currency",
    "TotalPaidTaxExcluding", "TotalPaidTaxIncluding",
    "ProductsTotalTaxExcluding", "ProductsTotalTaxIncluding",
    "DiscountTotalTaxExcluding", "DiscountTotalTaxIncluding",
    "OrderDetails",
];

const LINE_KEYS = [
    "ProductId", "ProductCode", "ProductName", "ProductQuantityType",
    "ProductQuantity", "VatRate",
    "ProductUnitPriceTaxExcluding", "ProductUnitPriceTaxIncluding",
];

describe("an order this shop hands a pulling integrator", () => {
    const answer = orderAnswer(ORDER, TAX) as Record<string, unknown>;

    it("carries every field the published example carries", () => {
        expect(ORDER_KEYS.filter((key) => !(key in answer))).toEqual([]);
    });

    it("carries every line field too", () => {
        const line = (answer.OrderDetails as Record<string, unknown>[])[0];
        expect(LINE_KEYS.filter((key) => !(key in line))).toEqual([]);
    });

    it("sends an integer where the schema shows an integer", () => {
        const line = (answer.OrderDetails as Record<string, unknown>[])[0];
        for (const [where, value] of [
            ["OrderId", answer.OrderId],
            ["PaymentTypeId", answer.PaymentTypeId],
            ["ProductId", line.ProductId],
            ["ProductQuantity", line.ProductQuantity],
            ["VatRate", line.VatRate],
        ] as const) {
            expect(Number.isInteger(value), `${where} is ${typeof value}`).toBe(true);
        }
        // And the one that matters most: it is the order's own number, so the
        // integrator can hand it back and be led to this row.
        expect(answer.OrderId).toBe(41591);
    });

    it("splits the totals the way the till split them", () => {
        // 20% inside 1200 is 200, not 240.
        expect(answer.TotalPaidTaxIncluding).toBe(1200);
        expect(answer.TotalPaidTaxExcluding).toBe(1000);
        expect(answer.ProductsTotalTaxIncluding).toBe(1200);
        expect(answer.ProductsTotalTaxExcluding).toBe(1000);
        expect(answer.DiscountTotalTaxIncluding).toBe(0);
    });

    it("writes the date the way the integrator reads it", () => {
        expect(answer.OrderDate).toBe("16.07.2026 10:30:00");
    });

    it("says what a quantity is counted in", () => {
        const line = (answer.OrderDetails as Record<string, unknown>[])[0];
        expect(line.ProductQuantityType).toBe("Adet");
    });

    it("fills the shipping fields for a shop that posts nothing", () => {
        // Empty would read as an incomplete order rather than a digital one.
        expect(answer.ShippingName).toBe("Örnek Müşteri");
        expect(answer.ShippingCity).toBe("Ankara");
    });

    it("has nobody to invoice, and says so, when the order carries no billing", () => {
        expect(orderAnswer({ ...ORDER, billingDetails: null }, TAX)).toBeNull();
    });
});

describe("the three endpoints", () => {
    it("agree on what a payment method's id is", () => {
        // `/api/paymentMethods` publishes `integerFor(gateway.id)` and an order
        // carries the same call for the same gateway.
        expect(integerFor("iyzico")).toBe(integerFor("iyzico"));
        expect(Number.isInteger(integerFor("iyzico"))).toBe(true);
        expect(integerFor("iyzico")).not.toBe(integerFor("paytr"));
    });

    it("agree on what a status id is, in both directions", () => {
        expect(statusNameFor(STATUS_IDS.COMPLETED)).toBe("COMPLETED");
        expect(statusNameFor(undefined)).toBe("COMPLETED");
        // A number this shop never published is refused rather than widening
        // the window to every order.
        expect(statusNameFor(99)).toBeNull();
        // The word is still accepted: an integrator set up against the old
        // answer keeps working until it refreshes its mapping.
        expect(statusNameFor("completed")).toBe("COMPLETED");
    });
});
