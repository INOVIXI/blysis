// @vitest-environment node
/**
 * The price a game shows before a purchase is the price the purchase takes.
 *
 * The in-game catalogue is one list for every player, so it carries the
 * product's own price. Measured live: the confirm button said "total 5,
 * balance after 38.49", and the purchase took 4 from a member who owned a
 * cheaper product on the same shelf. A quantity that reaches a bulk discount
 * was quoted at the full price the same way. The quote asks the function the
 * purchase asks, for the member who will own it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const product = {
    id: "p_big",
    name: "Big",
    type: "ONE_TIME",
    isActive: true,
    showInGame: true,
    giftable: true,
    categoryId: "c1",
    category: { id: "c1", showInGame: true },
    price: 5,
    salePrice: null,
    saleFrom: null,
    saleUntil: null,
    perPersonLimit: null,
};
const owned: { productId: string }[] = [];
const bulk: { minQuantity: number; discountPercent: number; isActive: boolean; productIds: string[]; categoryIds: string[] }[] = [];
let charged: number | null = null;

const db = {
    product: {
        findFirst: vi.fn(async () => product),
        findMany: vi.fn(async () =>
            owned.length === 0 ? [] : [{ id: "p_small", categoryId: "c1", price: 1, salePrice: null, saleFrom: null, saleUntil: null }],
        ),
    },
    ownedProduct: { findMany: vi.fn(async () => owned) },
    bulkDiscount: { findMany: vi.fn(async () => bulk) },
    productVariable: { findMany: vi.fn(async () => []) },
    setting: { findUnique: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({ receiveGifts: true, creditBalance: 100 })) },
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({})),
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    moduleSettings: vi.fn(async () => ({ enableUpgradeCredit: true, enableChestGifting: true, taxRate: 0, taxIncluded: true })),
    logActivity: vi.fn(async () => undefined),
    siteTimeZone: vi.fn(async () => "UTC"),
}));
vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async (_hook: string, value: unknown) => value),
    doActionAsync: vi.fn(async () => undefined),
    generateOrderNumber: () => "ORD-1",
}));
vi.mock("@/modules/store/lib/availability-server", async (original) => ({
    ...(await original<typeof import("@/modules/store/lib/availability-server")>()),
    availabilityFor: vi.fn(async () => ({ state: "open", buyable: true, remainingForPerson: null, remainingInPeriod: null })),
}));
vi.mock("@/modules/store/lib/credit-order", () => ({
    INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS",
    OUT_OF_STOCK: "OUT_OF_STOCK",
    createCreditOrder: vi.fn(async (_tx: unknown, input: { total: number }) => {
        charged = input.total;
        return { id: "o1", orderNumber: "ORD-1" };
    }),
    deliverPaidOrder: vi.fn(async () => undefined),
}));
vi.mock("@/modules/store/lib/order-events", () => ({
    announceOrderCreated: vi.fn(async () => undefined),
    announceOrderCompleted: vi.fn(async () => undefined),
}));

const { quoteWithCredits, purchaseWithCredits } = await import("@/modules/store/lib/credit-purchase");

const ask = { buyerId: "u1", productId: "p_big", quantity: 1, recipientId: null };
const buy = { ...ask, fields: {}, playerName: "Steve", playerId: "uuid-1", channel: "game:survival" };

beforeEach(() => {
    owned.length = 0;
    bulk.length = 0;
    charged = null;
});

describe("a price quoted in game", () => {
    it("is the product's price for a member with nothing to trade in", async () => {
        await expect(quoteWithCredits(ask)).resolves.toEqual({ ok: true, each: 5, total: 5 });
    });

    it("takes off a cheaper product the member owns on the same shelf, as the purchase does", async () => {
        owned.push({ productId: "p_small" });
        await expect(quoteWithCredits(ask)).resolves.toEqual({ ok: true, each: 4, total: 4 });
        await purchaseWithCredits(buy);
        expect(charged).toBe(4);
    });

    it("takes off the bulk discount the quantity reaches, as the purchase does", async () => {
        bulk.push({ minQuantity: 3, discountPercent: 20, isActive: true, productIds: ["p_big"], categoryIds: [] });
        await expect(quoteWithCredits({ ...ask, quantity: 3 })).resolves.toEqual({ ok: true, each: 4, total: 12 });
        await purchaseWithCredits({ ...buy, quantity: 3 });
        expect(charged).toBe(12);
    });

    it("refuses what a purchase would refuse before it looks at any money", async () => {
        await expect(quoteWithCredits({ ...ask, quantity: 0 })).resolves.toEqual({ ok: false, code: "quantity_invalid" });
        db.product.findFirst.mockResolvedValueOnce(null as never);
        await expect(quoteWithCredits(ask)).resolves.toEqual({ ok: false, code: "not_found" });
    });
});
