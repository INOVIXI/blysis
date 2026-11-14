// @vitest-environment node
/**
 * Selling a limited product takes it off the shelf.
 *
 * `Product.stock` is edited on the admin form, rendered on the product page as
 * "3 available", and checked when an item goes into a cart. Nothing had ever
 * subtracted from it. A shop with one of something sold it to everyone who
 * asked, for ever, and the number on the page stayed at one.
 *
 * The rule this fixes on:
 *
 *   - `stock: null` means unlimited and is never touched.
 *   - Stock is taken when the money arrives, not when the order is created,
 *     because an order that is never paid for must not hold anything.
 *   - The take is a conditional update, the same shape the credit balance
 *     uses: two settlements racing for the last one leave one of them with
 *     nothing to update rather than both succeeding and the count going
 *     negative.
 *   - A refund puts it back.
 *
 * The money has already moved by the time settlement runs, so a take that
 * fails cannot fail the order: the buyer paid and is granted what they bought.
 * It is recorded as an error instead, because a shop that sold more than it
 * had needs to hear about it from something other than a customer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface ProductRow {
    id: string;
    stock: number | null;
}

const products = new Map<string, ProductRow>();
const logError = vi.fn();

interface OrderRow {
    id: string;
    status: string;
    orderNumber: string;
    userId: string | null;
    total: number;
    currency: string;
    metadata: Record<string, unknown>;
    user: { email: string; username: string; locale?: string } | null;
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
        findMany: async ({ where }: { where: { id: { in: string[] }; stock: { not: null } } }) =>
            [...products.values()].filter((p) => where.id.in.includes(p.id) && p.stock !== null),
        updateMany: async ({ where, data }: {
            where: { id: string; stock?: { gte: number } };
            // Settlement also counts the sale, on the same table and in the
            // same transaction, so this stands in for both writes.
            data: { stock?: { decrement?: number; increment?: number }; unitsSold?: { increment?: number; decrement?: number } };
        }) => {
            const row = products.get(where.id);
            if (!row) return { count: 0 };
            if (where.stock && (row.stock === null || row.stock < where.stock.gte)) return { count: 0 };
            if (data.stock) {
                if (row.stock === null) return { count: 0 };
                row.stock -= data.stock.decrement ?? 0;
                row.stock += data.stock.increment ?? 0;
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
    log: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
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
    products.set("limited", { id: "limited", stock: 5 });
    products.set("unlimited", { id: "unlimited", stock: null });
    products.set("last-one", { id: "last-one", stock: 1 });
    order = orderFor([{ productId: "limited", quantity: 2 }]);
    payment = { id: "pay-1", orderId: "order-1", status: "COMPLETED" };
    logError.mockClear();
});

describe("when an order is paid for", () => {
    it("takes what was bought off the shelf", async () => {
        await settleOrder(settlement);
        expect(products.get("limited")!.stock).toBe(3);
    });

    it("leaves a product with no limit alone", async () => {
        order = orderFor([{ productId: "unlimited", quantity: 7 }]);
        const outcome = await settleOrder(settlement);
        expect(outcome.error).toBeNull();
        expect(products.get("unlimited")!.stock).toBeNull();
    });

    it("takes from each limited product in the order", async () => {
        order = orderFor([
            { productId: "limited", quantity: 1 },
            { productId: "last-one", quantity: 1 },
            { productId: "unlimited", quantity: 3 },
        ]);
        await settleOrder(settlement);
        expect(products.get("limited")!.stock).toBe(4);
        expect(products.get("last-one")!.stock).toBe(0);
    });

    it("does not take the same stock twice when the webhook is retried", async () => {
        await settleOrder(settlement);
        const outcome = await settleOrder(settlement);
        expect(outcome.duplicate).toBe(true);
        expect(products.get("limited")!.stock).toBe(3);
    });
});

describe("when the shelf is emptier than the order", () => {
    it("never lets the count go below zero", async () => {
        order = orderFor([{ productId: "last-one", quantity: 3 }]);
        await settleOrder(settlement);
        expect(products.get("last-one")!.stock).toBe(1);
    });

    it("still completes the order, because the money already moved", async () => {
        order = orderFor([{ productId: "last-one", quantity: 3 }]);
        const outcome = await settleOrder(settlement);
        expect(outcome.handled).toBe(true);
        expect(outcome.error).toBeNull();
        expect(order.status).toBe("COMPLETED");
    });

    it("says so, loudly, because nobody else will notice", async () => {
        order = orderFor([{ productId: "last-one", quantity: 3 }]);
        await settleOrder(settlement);
        expect(logError).toHaveBeenCalled();
    });
});

describe("when the order is refunded", () => {
    it("puts the stock back", async () => {
        await settleOrder(settlement);
        expect(products.get("limited")!.stock).toBe(3);

        await refundPayment("stripe", "pi_123");

        expect(products.get("limited")!.stock).toBe(5);
    });

    it("does not put it back twice", async () => {
        await settleOrder(settlement);
        await refundPayment("stripe", "pi_123");
        payment = { id: "pay-1", orderId: "order-1", status: "REFUNDED" };

        await refundPayment("stripe", "pi_123");

        expect(products.get("limited")!.stock).toBe(5);
    });

    it("leaves an unlimited product alone", async () => {
        order = orderFor([{ productId: "unlimited", quantity: 4 }]);
        await settleOrder(settlement);
        await refundPayment("stripe", "pi_123");
        expect(products.get("unlimited")!.stock).toBeNull();
    });
});
