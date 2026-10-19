// @vitest-environment node
/**
 * One purchase a game asks for is one order, however its retries meet the
 * first attempt.
 *
 * The hook a game's purchase reaches the store through gives up on a listener
 * after a few seconds and answers "unavailable", while the listener goes on
 * and makes the order. The game, told nothing was decided, asks again with
 * the same key, and game-connect frees a key whose answer was a 5xx. Measured
 * live with a slow site: one key, two orders, the member charged twice. The
 * store now writes the key on the order, and inside the purchase's
 * transaction, under a lock on that key, hands back the order the key already
 * made instead of making another.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const product = {
    id: "p1",
    name: "Thing",
    type: "ONE_TIME",
    isActive: true,
    showInGame: true,
    giftable: true,
    categoryId: "c1",
    category: { id: "c1", showInGame: true },
    price: 1,
    salePrice: null,
    saleFrom: null,
    saleUntil: null,
    perPersonLimit: null,
};

type Kept = { id: string; orderNumber: string; total: number; metadata: Record<string, unknown> };
let existing: Kept | null = null;
let committedBefore: Kept | null = null;
const created: Record<string, unknown>[] = [];
const locks: string[] = [];

const tx = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        locks.push(String(values[0]));
        return 1;
    }),
    order: { findFirst: vi.fn(async () => existing) },
};
const db = {
    product: { findFirst: vi.fn(async () => product), findMany: vi.fn(async () => []) },
    ownedProduct: { findMany: vi.fn(async () => []) },
    bulkDiscount: { findMany: vi.fn(async () => []) },
    productVariable: { findMany: vi.fn(async () => []) },
    setting: { findUnique: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({ receiveGifts: true, creditBalance: 9 })) },
    // Before the transaction the first attempt has not committed yet, unless a test says it has.
    order: { findFirst: vi.fn(async () => committedBefore) },
    $transaction: vi.fn(async (work: (t: unknown) => unknown) => work(tx)),
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
const delivered = vi.fn(async () => undefined);
vi.mock("@/modules/store/lib/credit-order", () => ({
    INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS",
    OUT_OF_STOCK: "OUT_OF_STOCK",
    createCreditOrder: vi.fn(async (_tx: unknown, input: Record<string, unknown>) => {
        created.push(input);
        return { id: `o${created.length}`, orderNumber: `ORD-${created.length}` };
    }),
    deliverPaidOrder: (...args: unknown[]) => delivered(...args),
}));
vi.mock("@/modules/store/lib/order-events", () => ({
    announceOrderCreated: vi.fn(async () => undefined),
    announceOrderCompleted: vi.fn(async () => undefined),
}));

const { purchaseWithCredits } = await import("@/modules/store/lib/credit-purchase");

const request = {
    buyerId: "u1",
    productId: "p1",
    quantity: 1,
    fields: {},
    recipientId: null,
    playerName: "Steve",
    playerId: "uuid-1",
    channel: "game:survival",
    idempotencyKey: "gs1:key-1",
};

beforeEach(() => {
    db.product.findFirst.mockReset();
    db.product.findFirst.mockImplementation(async () => product);
    existing = null;
    committedBefore = null;
    created.length = 0;
    locks.length = 0;
    delivered.mockClear();
});

describe("a purchase in game with a key", () => {
    it("writes the key on the order it makes, under a lock on that key", async () => {
        await expect(purchaseWithCredits(request)).resolves.toMatchObject({ ok: true, orderNumber: "ORD-1" });
        expect(locks).toContain("store-purchase:gs1:key-1");
        expect(created[0]).toMatchObject({ metadata: expect.objectContaining({ gameKey: "gs1:key-1" }) });
    });

    it("hands back the order the key already made, and makes and delivers no other", async () => {
        existing = { id: "o0", orderNumber: "ORD-FIRST", total: 1, metadata: { gameKey: "gs1:key-1" } };
        await expect(purchaseWithCredits(request)).resolves.toMatchObject({ ok: true, orderId: "o0", orderNumber: "ORD-FIRST", total: 1, balance: 9, gift: false });
        expect(created).toHaveLength(0);
        expect(delivered).not.toHaveBeenCalled();
    });

    it("hands back a gift as a gift", async () => {
        existing = { id: "o0", orderNumber: "ORD-GIFT", total: 1, metadata: { gameKey: "gs1:key-1", gift: true } };
        await expect(purchaseWithCredits({ ...request, recipientId: "u2" })).resolves.toMatchObject({ ok: true, gift: true });
    });

    it("answers a retry whose first attempt finished before it, even where the limit is now used up", async () => {
        committedBefore = { id: "o0", orderNumber: "ORD-FIRST", total: 1, metadata: { gameKey: "gs1:key-1" } };
        db.product.findFirst.mockResolvedValueOnce({ ...product, perPersonLimit: 1 } as never);
        await expect(purchaseWithCredits(request)).resolves.toMatchObject({ ok: true, orderNumber: "ORD-FIRST" });
        expect(created).toHaveLength(0);
    });

    it("without a key, makes the order as before", async () => {
        const { idempotencyKey: _unused, ...unkeyed } = request;
        await expect(purchaseWithCredits(unkeyed)).resolves.toMatchObject({ ok: true });
        expect(locks).toHaveLength(0);
        expect(created[0]?.metadata).not.toHaveProperty("gameKey");
    });
});
