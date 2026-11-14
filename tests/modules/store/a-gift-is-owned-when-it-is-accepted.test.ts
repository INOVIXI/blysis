// @vitest-environment node
/**
 * A gift is the recipient's only once they accept it. Until then the sender
 * can take it back and be refunded, so a product it grants must not count as
 * owned: an upgrade ladder prices the next rung off what a member owns, and a
 * cheap rung gifted and then taken back would leave the recipient paying only
 * the difference for the top one. Ownership is written when the gift is
 * accepted, and a gift that is taken back leaves none.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = {
    owned: [] as { data: { userId: string; productId: string; orderId?: string }[] }[],
};
const order = { id: "o1", orderNumber: "ORD-1" };

const tx = {
    order: { create: vi.fn(async () => ({ ...order, items: [] })), update: vi.fn(async () => ({})) },
    chestItem: {
        createMany: vi.fn(async () => ({ count: 1 })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    // A refund withdraws the thank-you coupon the order earned; these orders earned none.
    coupon: { updateMany: vi.fn(async () => ({ count: 0 })) },
    ownedProduct: {
        createMany: vi.fn(async (args: { data: { userId: string; productId: string; orderId?: string }[] }) => {
            calls.owned.push(args);
            return { count: args.data.length };
        }),
        deleteMany: vi.fn(async () => ({ count: 0 })),
    },
};
const db = {
    chestItem: { findFirst: vi.fn(), updateMany: tx.chestItem.updateMany },
    order: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(async () => ({ creditBalance: 10 })) },
    $transaction: vi.fn(async (work: (t: typeof tx) => Promise<unknown>) => work(tx)),
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    moduleSettings: vi.fn(async () => ({})),
}));
vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async () => ({ applied: true })),
    generateOrderNumber: () => "ORD-1",
}));
vi.mock("@/modules/store/lib/stock", () => ({
    claimStock: vi.fn(async () => []),
    releaseStock: vi.fn(async () => undefined),
    stockClaims: vi.fn(() => []),
}));
vi.mock("@/modules/store/lib/popularity", () => ({
    countSales: vi.fn(async () => undefined),
    uncountSales: vi.fn(async () => undefined),
}));
vi.mock("@/modules/store/lib/chest", () => ({
    recordedVariables: vi.fn(() => null),
    deliveryFor: vi.fn(),
}));
vi.mock("@/modules/store/lib/delivery", () => ({ deliverProduct: vi.fn(async () => undefined) }));

const { createCreditOrder } = await import("@/modules/store/lib/credit-order");
const { activateGift, cancelGift } = await import("@/modules/store/lib/gifts");

const line = { productId: "rung1", name: "Rung 1", price: 5, quantity: 1, metadata: {} };
const input = {
    buyerId: "ada",
    ownerId: "bo",
    gift: true,
    lines: [line],
    subtotal: 5,
    discount: 0,
    tax: 0,
    total: 5,
    currency: "usd",
    billingDetails: {},
    metadata: { gift: true, recipientId: "bo" },
    playerName: null,
    description: "Gift",
};

const boughtGift = { id: "c1", userId: "bo", productId: "rung1", orderId: "o1", giftedById: "ada", giftState: "pending", isRedeemed: false };

beforeEach(() => {
    calls.owned.length = 0;
    vi.clearAllMocks();
    tx.chestItem.updateMany.mockResolvedValue({ count: 1 });
    db.chestItem.findFirst.mockResolvedValue(boughtGift);
    db.order.findUnique.mockResolvedValue({ id: "o1", userId: "ada", orderNumber: "ORD-1", total: 5, items: [], metadata: { gift: true } });
});

describe("a gift's ownership", () => {
    it("is not written when the gift is bought, because the sender can still take it back", async () => {
        await createCreditOrder(tx as never, input);
        expect(calls.owned).toEqual([]);
    });

    it("is still written at once for a purchase the buyer keeps", async () => {
        await createCreditOrder(tx as never, { ...input, gift: false, ownerId: "ada", metadata: {} });
        expect(calls.owned).toHaveLength(1);
        expect(calls.owned[0].data).toEqual([{ userId: "ada", productId: "rung1", orderId: "o1" }]);
    });

    it("is written for the recipient when they accept", async () => {
        const result = await activateGift("bo", "c1");
        expect(result).toEqual({ ok: true });
        expect(calls.owned).toHaveLength(1);
        expect(calls.owned[0].data).toEqual([{ userId: "bo", productId: "rung1", orderId: "o1" }]);
    });

    it("is not written when the accept finds the gift already taken back", async () => {
        tx.chestItem.updateMany.mockResolvedValue({ count: 0 });
        const result = await activateGift("bo", "c1");
        expect(result.ok).toBe(false);
        expect(calls.owned).toEqual([]);
    });

    it("is not written for an item a member handed over from their own chest", async () => {
        db.chestItem.findFirst.mockResolvedValue({ ...boughtGift, giftedById: "cy" });
        const result = await activateGift("bo", "c1");
        expect(result).toEqual({ ok: true });
        expect(calls.owned).toEqual([]);
    });

    it("is left with nobody when the sender takes the gift back", async () => {
        const result = await cancelGift("ada", "c1");
        expect(result.ok).toBe(true);
        expect(calls.owned).toEqual([]);
    });
});
