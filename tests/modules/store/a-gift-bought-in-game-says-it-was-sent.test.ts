// @vitest-environment node
/**
 * A gift bought in game says it was sent, after it is paid for, so a module
 * that tells the recipient in game can. A purchase for oneself says nothing
 * of the kind.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const order = { id: "o1", orderNumber: "ORD-1", items: [] };
const tx = { $executeRaw: vi.fn(async () => 1) };
const inGame = {
    id: "p1",
    name: "Rank",
    price: 5,
    categoryId: "c1",
    isActive: true,
    showInGame: true,
    giftable: true,
    type: "ONE_TIME",
    perPersonLimit: null as number | null,
    category: { id: "c1", showInGame: true },
};
const db = {
    product: {
        findFirst: vi.fn(async () => ({
            id: "p1",
            name: "Rank",
            price: 5,
            categoryId: "c1",
            isActive: true,
            showInGame: true,
            giftable: true,
            type: "ONE_TIME",
            perPersonLimit: 1 as number | null,
            category: { id: "c1", showInGame: true },
        })),
    },
    user: { findUnique: vi.fn(async () => ({ receiveGifts: true, creditBalance: 10 })) },
    productVariable: { findMany: vi.fn(async () => []) },
    bulkDiscount: { findMany: vi.fn(async () => []) },
    setting: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (work: (t: typeof tx) => Promise<unknown>) => work(tx)),
};
const counts: Array<{ state: string; buyable: boolean; remainingForPerson: number | null }> = [];

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    moduleSettings: vi.fn(async () => ({ enableChestGifting: true, taxRate: 0, taxIncluded: true })),
    logActivity: vi.fn(async () => undefined),
    siteTimeZone: vi.fn(async () => "UTC"),
}));
const actions: Array<{ hook: string; payload: unknown }> = [];
vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async (_hook: string, value: unknown) => value),
    doActionAsync: vi.fn(async (hook: string, payload: unknown) => {
        actions.push({ hook, payload });
    }),
    generateOrderNumber: () => "ORD-1",
}));
vi.mock("@/modules/store/lib/availability-server", () => ({
    availabilityFor: vi.fn(async () => ({ remainingInPeriod: null, price: 5, was: null, onSale: false, ...counts.shift() })),
    rulesOf: vi.fn(() => ({ salePrice: null, saleFrom: null, saleUntil: null, price: 5 })),
}));
vi.mock("@/modules/store/lib/upgrade-credit-server", () => ({
    creditingPurchases: vi.fn(async () => []),
    ownedRungsOn: vi.fn(async () => []),
}));
vi.mock("@/modules/store/lib/credit-order", () => ({
    createCreditOrder: vi.fn(async () => order),
    deliverPaidOrder: vi.fn(async () => undefined),
    INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS",
    OUT_OF_STOCK: "OUT_OF_STOCK",
}));
vi.mock("@/modules/store/lib/order-events", () => ({
    announceOrderCreated: vi.fn(async () => undefined),
    announceOrderCompleted: vi.fn(async () => undefined),
}));

const { purchaseWithCredits } = await import("@/modules/store/lib/credit-purchase");

const request = {
    buyerId: "u1",
    productId: "p1",
    quantity: 2,
    fields: {},
    recipientId: null as string | null,
    playerName: "Steve",
    playerId: "uuid-1",
    channel: "game:survival",
};

beforeEach(() => {
    vi.clearAllMocks();
    actions.length = 0;
    counts.length = 0;
    db.product.findFirst.mockResolvedValue({ ...inGame, perPersonLimit: null });
});

describe("a purchase in game", () => {
    it("bought as a gift says who sent what to whom", async () => {
        counts.push({ state: "open", buyable: true, remainingForPerson: null });

        await expect(purchaseWithCredits({ ...request, recipientId: "u2" })).resolves.toMatchObject({ ok: true, gift: true });
        expect(actions).toContainEqual({
            hook: "store.gift.sent",
            payload: { senderId: "u1", recipientId: "u2", productName: "Rank", quantity: 2 },
        });
    });

    it("bought for oneself says no gift was sent", async () => {
        counts.push({ state: "open", buyable: true, remainingForPerson: null });

        await expect(purchaseWithCredits(request)).resolves.toMatchObject({ ok: true, gift: false });
        expect(actions.map((action) => action.hook)).not.toContain("store.gift.sent");
    });
});
