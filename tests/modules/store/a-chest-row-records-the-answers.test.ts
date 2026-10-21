/**
 * The chest is written at settlement, so that is where the answers are taken.
 *
 * Checkout collects the name to deliver to and the fields the product asks
 * for, puts them on the order, and hands them to delivery for anything
 * delivered right away. What waits in the chest was written from the same
 * order and kept none of it, so the answers existed on one row and not on the
 * one that needed them.
 *
 * They are read off the order rather than passed in, because settlement is
 * also reached by a gateway's webhook minutes later, where nobody is holding
 * a form any more.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PaymentSettlement } from "@/modules/store/lib/payments";

const db = {
    order: { findUnique: vi.fn(), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    chestItem: { create: vi.fn(async () => ({})), createMany: vi.fn(async () => ({ count: 1 })) },
    ownedProduct: { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})), createMany: vi.fn(async () => ({ count: 1 })), deleteMany: vi.fn(async () => ({})) },
    payment: { create: vi.fn(async () => ({})), findFirst: vi.fn(), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    productCommand: { findMany: vi.fn(async () => []) },
    product: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
    user: { findUnique: vi.fn(async () => ({ roleId: null })), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    creditTransaction: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    subscription: { findFirst: vi.fn(), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    timedRoleGrant: { upsert: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({})) },
    role: { findMany: vi.fn(async () => []) },
};

vi.mock("@/core/sdk/server", () => ({
    prisma: { ...db, $transaction: async (run: (tx: typeof db) => unknown) => run(db) },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    logActivity: vi.fn(async () => {}),
}));
vi.mock("@/modules/store/lib/order-email", () => ({ sendOrderConfirmationEmail: vi.fn(async () => {}) }));
vi.mock("@/modules/store/lib/delivery", () => ({ deliverProduct: vi.fn(async () => {}) }));
vi.mock("@/modules/store/lib/order-events", () => ({ announceOrderCompleted: vi.fn(async () => {}) }));

const { settleOrder } = await import("@/modules/store/lib/fulfilment");

const settlement: PaymentSettlement = {
    kind: "order",
    reference: "order-1",
    provider: "manual",
    providerRef: "ref-1",
    amount: 42,
    currency: "USD",
};

function orderWith(metadata: Record<string, unknown>, itemMetadata: Record<string, unknown> = {}) {
    return {
        id: "order-1",
        status: "PENDING",
        orderNumber: "ORD-1",
        userId: "user-1",
        total: 42,
        currency: "USD",
        metadata,
        user: { email: "buyer@example.com", username: "steve" },
        items: [{ id: "i1", productId: "prod-1", name: "VIP", quantity: 1, price: 42, metadata: itemMetadata }],
    };
}

const writtenRows = () =>
    (db.chestItem.createMany.mock.calls[0][0] as { data: Record<string, unknown>[] }).data;

beforeEach(() => {
    vi.clearAllMocks();
    db.order.updateMany.mockResolvedValue({ count: 1 });
    db.chestItem.createMany.mockResolvedValue({ count: 1 });
    db.ownedProduct.createMany.mockResolvedValue({ count: 1 });
    db.ownedProduct.findMany.mockResolvedValue([]);
    db.product.findMany.mockResolvedValue([]);
    db.user.findUnique.mockResolvedValue({ roleId: null });
});

describe("what settlement writes into the chest", () => {
    it("records the name the buyer gave", async () => {
        db.order.findUnique.mockResolvedValue(orderWith({ playerName: "Steve_MC" }));
        await settleOrder(settlement);
        expect(writtenRows()[0]).toMatchObject({ playerName: "Steve_MC" });
    });

    it("records the fields that line asked for", async () => {
        db.order.findUnique.mockResolvedValue(
            orderWith({ playerName: "Steve_MC" }, { variables: { server: "survival" } }),
        );
        await settleOrder(settlement);
        expect(writtenRows()[0]).toMatchObject({ variables: { server: "survival" } });
    });

    it("records no name at all rather than the account's username", async () => {
        // An order taken by hand has no player name on it. "steve" is on the
        // user row and is the wrong answer; the screen asks when it is time.
        db.order.findUnique.mockResolvedValue(orderWith({ manual: true }));
        await settleOrder(settlement);
        expect(writtenRows()[0]).toMatchObject({ playerName: null });
    });

    it("ignores a name on the order that is not one", async () => {
        db.order.findUnique.mockResolvedValue(orderWith({ playerName: { first: "Steve" } }));
        await settleOrder(settlement);
        expect(writtenRows()[0]).toMatchObject({ playerName: null });
    });
});
