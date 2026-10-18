// @vitest-environment node
/**
 * A per-person limit holds against purchases sent together.
 *
 * The count before the transaction is a snapshot. Ten purchases of a
 * one-per-account product sent at once from a game all read "none bought
 * yet", and four of them went through. The purchase now takes a lock on the
 * member and the product inside its transaction and counts again there, so
 * the second purchase waits for the first and then sees it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const order = { id: "o1", orderNumber: "ORD-1", items: [] };
const tx = { $executeRaw: vi.fn(async () => 1) };
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
vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async (_hook: string, value: unknown) => value),
    doActionAsync: vi.fn(async () => undefined),
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
const { createCreditOrder } = await import("@/modules/store/lib/credit-order");

const request = {
    buyerId: "u1",
    productId: "p1",
    quantity: 1,
    fields: {},
    recipientId: null,
    playerName: "Steve",
    playerId: "uuid-1",
    channel: "game:survival",
};

beforeEach(() => {
    vi.clearAllMocks();
    counts.length = 0;
});

describe("a purchase of a product with a per-person limit", () => {
    it("is refused when the limit filled while it waited for the lock", async () => {
        counts.push({ state: "open", buyable: true, remainingForPerson: 1 });
        counts.push({ state: "limit_reached", buyable: false, remainingForPerson: 0 });

        await expect(purchaseWithCredits(request)).resolves.toMatchObject({ ok: false, code: "limit_reached" });
        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
        expect(createCreditOrder).not.toHaveBeenCalled();
    });

    it("goes through when the count inside the lock still leaves room", async () => {
        counts.push({ state: "open", buyable: true, remainingForPerson: 1 });
        counts.push({ state: "open", buyable: true, remainingForPerson: 1 });

        await expect(purchaseWithCredits(request)).resolves.toMatchObject({ ok: true, orderId: "o1" });
        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
        expect(createCreditOrder).toHaveBeenCalledTimes(1);
    });

    it("takes no lock for a product without a limit", async () => {
        db.product.findFirst.mockResolvedValueOnce({ ...(await db.product.findFirst()), perPersonLimit: null });
        counts.push({ state: "open", buyable: true, remainingForPerson: null });

        await expect(purchaseWithCredits(request)).resolves.toMatchObject({ ok: true });
        expect(tx.$executeRaw).not.toHaveBeenCalled();
    });
});
