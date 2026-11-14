// @vitest-environment node
/**
 * How often a product has sold is a number the product carries.
 *
 * The shop's "most popular" sort worked it out on every request: a `groupBy`
 * over every paid order item, joined to Order for the status and to Product
 * for the list's own filter, with no limit, because the ranking has to be
 * complete before a page of it can be cut. Measured in a scratch schema with
 * 50,000 orders, 150,000 order items and 3,000 products - a small shop after a
 * couple of busy years:
 *
 *     the aggregation, as the route runs it            90.3 ms
 *     ordering by a counter on Product, indexed         1.0 ms
 *
 * So the number is kept on the row and maintained where the sale happens: up
 * when an order is paid for, down when it is refunded, in the same transaction
 * that grants the products, because a count that can drift from the orders is
 * worse than one that costs 90 ms.
 *
 * It counts units rather than order lines. `unitsSold` is the name because
 * that is what it holds: an order for five of something moves it by five. The
 * old ranking counted lines, which was what a `groupBy` could express rather
 * than what "most sold" means.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface ProductRow {
    id: string;
    stock: number | null;
    unitsSold: number;
}

const products = new Map<string, ProductRow>();

interface OrderRow {
    id: string;
    status: string;
    orderNumber: string;
    userId: string | null;
    total: number;
    currency: string;
    metadata: Record<string, unknown>;
    user: { email: string; username: string } | null;
    items: { productId: string | null; name: string; quantity: number }[];
}

let order: OrderRow;
let payment: { id: string; orderId: string; status: string } | null;

const db = {
    order: {
        findUnique: async () => order,
        update: async () => ({}),
        updateMany: async ({ where }: { where: { status?: { not: string } } }) => {
            if (where.status?.not && order.status === where.status.not) return { count: 0 };
            order.status = "COMPLETED";
            return { count: 1 };
        },
    },
    product: {
        findMany: async ({ where }: { where: { id: { in: string[] }; stock?: { not: null } } }) =>
            [...products.values()].filter(
                (p) => where.id.in.includes(p.id) && (where.stock === undefined || p.stock !== null),
            ),
        updateMany: async ({ where, data }: {
            where: { id: string; stock?: { gte: number }; unitsSold?: { gte: number } };
            data: { stock?: { decrement?: number; increment?: number }; unitsSold?: { decrement?: number; increment?: number } };
        }) => {
            const row = products.get(where.id);
            if (!row) return { count: 0 };
            if (where.stock && (row.stock === null || row.stock < where.stock.gte)) return { count: 0 };
            if (where.unitsSold && row.unitsSold < where.unitsSold.gte) return { count: 0 };
            if (data.stock && row.stock !== null) {
                row.stock -= data.stock.decrement ?? 0;
                row.stock += data.stock.increment ?? 0;
            }
            if (data.unitsSold) {
                row.unitsSold -= data.unitsSold.decrement ?? 0;
                row.unitsSold += data.unitsSold.increment ?? 0;
            }
            return { count: 1 };
        },
    },
    // A refund also takes back what the order granted; these orders granted
    // nothing the counting here is about. `fulfilment.test.ts` covers that.
    chestItem: { createMany: async () => ({ count: 1 }), deleteMany: async () => ({ count: 0 }), findMany: async () => [] },
    // A refund withdraws the thank-you coupon the order earned; these orders earned none.
    coupon: { updateMany: vi.fn(async () => ({ count: 0 })) },
    ownedProduct: { createMany: async () => ({ count: 1 }), findMany: async () => [] },
    payment: {
        create: async () => ({}),
        findFirst: async () => payment,
        update: async () => ({}),
        updateMany: async ({ where }: { where: { status?: { not: string } } }) => {
            if (!payment) return { count: 0 };
            if (where.status?.not && payment.status === where.status.not) return { count: 0 };
            payment.status = "REFUNDED";
            return { count: 1 };
        },
    },
    productCommand: { findMany: async () => [] },
    $transaction: async (arg: unknown) => {
        if (typeof arg === "function") return await (arg as (tx: unknown) => Promise<unknown>)(db);
        return await Promise.all(arg as Promise<unknown>[]);
    },
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    // Settlement asks whether the shop thanks buyers with a coupon; it does not here.
    moduleSettings: vi.fn(async () => ({})),
}));
vi.mock("@/modules/store/lib/order-email", () => ({ sendOrderConfirmationEmail: async () => undefined }));
vi.mock("@/modules/store/lib/delivery", () => ({ deliverProduct: async () => ({}) }));
vi.mock("@/modules/store/lib/order-events", () => ({
    announceOrderCompleted: async () => undefined,
    announceOrderRefunded: async () => undefined,
}));

const { settleOrder, refundPayment } = await import("@/modules/store/lib/fulfilment");

const settlement = {
    kind: "order" as const,
    reference: "order-1",
    provider: "stripe",
    providerRef: "pi_123",
    amount: 42,
    currency: "USD",
    metadata: {},
};

function orderFor(items: { productId: string; quantity: number }[]): OrderRow {
    return {
        id: "order-1",
        status: "PENDING",
        orderNumber: "ORD-1",
        userId: "user-1",
        total: 42,
        currency: "USD",
        metadata: {},
        user: { email: "buyer@example.com", username: "Steve" },
        items: items.map((i) => ({ productId: i.productId, name: i.productId, quantity: i.quantity })),
    };
}

beforeEach(() => {
    products.clear();
    products.set("mug", { id: "mug", stock: null, unitsSold: 0 });
    products.set("rank", { id: "rank", stock: 100, unitsSold: 7 });
    order = orderFor([{ productId: "mug", quantity: 1 }]);
    payment = { id: "pay-1", orderId: "order-1", status: "COMPLETED" };
});

describe("when an order is paid for", () => {
    it("counts what sold", async () => {
        await settleOrder(settlement);
        expect(products.get("mug")!.unitsSold).toBe(1);
    });

    it("counts every unit, not every line", async () => {
        order = orderFor([{ productId: "mug", quantity: 5 }]);
        await settleOrder(settlement);
        expect(products.get("mug")!.unitsSold).toBe(5);
    });

    it("counts a product the shop does not stock, because popularity is not stock", async () => {
        order = orderFor([{ productId: "mug", quantity: 2 }]);
        await settleOrder(settlement);
        expect(products.get("mug")!.stock).toBeNull();
        expect(products.get("mug")!.unitsSold).toBe(2);
    });

    it("adds to what a product had already sold", async () => {
        order = orderFor([{ productId: "rank", quantity: 3 }]);
        await settleOrder(settlement);
        expect(products.get("rank")!.unitsSold).toBe(10);
    });

    it("counts the same order once, however often the webhook arrives", async () => {
        await settleOrder(settlement);
        await settleOrder(settlement);
        expect(products.get("mug")!.unitsSold).toBe(1);
    });
});

describe("when the order is refunded", () => {
    it("takes the sale back out of the count", async () => {
        order = orderFor([{ productId: "rank", quantity: 3 }]);
        await settleOrder(settlement);
        await refundPayment("stripe", "pi_123");
        expect(products.get("rank")!.unitsSold).toBe(7);
    });

    it("does not take it out twice", async () => {
        order = orderFor([{ productId: "rank", quantity: 3 }]);
        await settleOrder(settlement);
        await refundPayment("stripe", "pi_123");
        payment = { id: "pay-1", orderId: "order-1", status: "REFUNDED" };
        await refundPayment("stripe", "pi_123");
        expect(products.get("rank")!.unitsSold).toBe(7);
    });

    it("never counts below zero, whatever order the notifications arrive in", async () => {
        // A refund for a sale this counter never saw - an order settled before
        // the column existed, say - must not push it negative.
        products.set("mug", { id: "mug", stock: null, unitsSold: 0 });
        order = orderFor([{ productId: "mug", quantity: 2 }]);
        order.status = "COMPLETED";
        await refundPayment("stripe", "pi_123");
        expect(products.get("mug")!.unitsSold).toBe(0);
    });
});
