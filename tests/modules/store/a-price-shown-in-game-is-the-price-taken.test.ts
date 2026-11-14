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
/** The campaigns switched on, each open all day, every day. */
const campaigns: { isActive: boolean; days: number[]; fromMinute: null; untilMinute: null; entries: { productId: string; price: number; stock: null }[] }[] = [];
const bulk: { minQuantity: number; discountPercent: number; isActive: boolean; productIds: string[]; categoryIds: string[] }[] = [];
let charged: number | null = null;
let kept: Record<string, unknown> | null = null;
/** What a tax module answers, when one is listening. */
const taxModule = { current: null as StoreTaxAnswer | null };
const taxAsked: StoreTaxContext[] = [];

/** The store-wide sales running, none unless a test starts one. */
const storeSales: Record<string, unknown>[] = [];

const db = {
    storeSale: { findMany: vi.fn(async () => storeSales) },
    product: {
        findFirst: vi.fn(async () => product),
        // The catalogue asks for what games show; the upgrade credit asks for
        // the rungs a member owns.
        findMany: vi.fn(async (args?: { where?: { showInGame?: boolean } }) =>
            args?.where?.showInGame ? [product]
            : owned.length === 0 ? [] : [{ id: "p_small", categoryId: "c1", price: 1, salePrice: null, saleFrom: null, saleUntil: null }],
        ),
    },
    ownedProduct: { findMany: vi.fn(async () => owned) },
    campaign: { findMany: vi.fn(async () => campaigns) },
    category: { findMany: vi.fn(async () => [{ id: "c1", name: "Ranks", icon: null }]) },
    productCommand: { findMany: vi.fn(async () => []) },
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
vi.mock("@/core/sdk", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/core/sdk")>()),
    applyFiltersAsync: vi.fn(async (hook: string, value: unknown, context: unknown) => {
        if (hook !== "store.tax") return value;
        taxAsked.push(context as StoreTaxContext);
        return taxModule.current ?? value;
    }),
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
    createCreditOrder: vi.fn(async (_tx: unknown, input: { total: number; metadata: Record<string, unknown> }) => {
        charged = input.total;
        kept = input.metadata;
        return { id: "o1", orderNumber: "ORD-1" };
    }),
    deliverPaidOrder: vi.fn(async () => undefined),
}));
vi.mock("@/modules/store/lib/order-events", () => ({
    announceOrderCreated: vi.fn(async () => undefined),
    announceOrderCompleted: vi.fn(async () => undefined),
}));

const { quoteWithCredits, purchaseWithCredits } = await import("@/modules/store/lib/credit-purchase");
const { inGameCatalog } = await import("@/modules/store/lib/ingame-catalog");

const ask = { buyerId: "u1", productId: "p_big", quantity: 1, recipientId: null };
const buy = { ...ask, fields: {}, playerName: "Steve", playerId: "uuid-1", channel: "game:survival" };

beforeEach(() => {
    storeSales.length = 0;
    owned.length = 0;
    bulk.length = 0;
    campaigns.length = 0;
    charged = null;
    kept = null;
    taxModule.current = null;
    taxAsked.length = 0;
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

    it("takes off a store-wide sale that covers the shelf, as the purchase does", async () => {
        storeSales.push({
            id: "s1", name: "Weekend", percent: 20, categoryIds: [], isActive: true,
            startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 60_000),
        });
        await expect(quoteWithCredits(ask)).resolves.toEqual({ ok: true, each: 4, total: 4 });
        await purchaseWithCredits(buy);
        expect(charged).toBe(4);
    });

    it("is the running campaign's price, in the catalogue, the quote and the purchase", async () => {
        campaigns.push({ isActive: true, days: [], fromMinute: null, untilMinute: null, entries: [{ productId: "p_big", price: 3, stock: null }] });
        const catalogue = await inGameCatalog();
        expect(catalogue.categories[0]?.products[0]?.price).toBe(3);
        await expect(quoteWithCredits(ask)).resolves.toEqual({ ok: true, each: 3, total: 3 });
        await purchaseWithCredits(buy);
        expect(charged).toBe(3);
    });

    it("for a gift, is refused where the gift would be, and tells nothing of what the member owns", async () => {
        owned.push({ productId: "p_small" });
        db.user.findUnique.mockResolvedValueOnce({ receiveGifts: false, creditBalance: 0 } as never);
        await expect(quoteWithCredits({ ...ask, recipientId: "u2" })).resolves.toEqual({ ok: false, code: "recipient_refuses_gifts" });
        db.product.findFirst.mockResolvedValueOnce({ ...product, giftable: false } as never);
        await expect(quoteWithCredits({ ...ask, recipientId: "u2" })).resolves.toEqual({ ok: false, code: "not_giftable" });
    });

    it("refuses what a purchase would refuse before it looks at any money", async () => {
        await expect(quoteWithCredits({ ...ask, quantity: 0 })).resolves.toEqual({ ok: false, code: "quantity_invalid" });
        db.product.findFirst.mockResolvedValueOnce(null as never);
        await expect(quoteWithCredits(ask)).resolves.toEqual({ ok: false, code: "not_found" });
    });
});

describe("tax on a purchase made in game", () => {
    it("is what a tax module answers for a buyer it knows nothing about, as the site would charge", async () => {
        taxModule.current = {
            rate: 10,
            included: false,
            label: { kind: "preset", id: "gst" },
            country: null,
            reason: "standard",
            evidence: null,
        };
        await expect(quoteWithCredits(ask)).resolves.toEqual({ ok: true, each: 5, total: 5.5 });
        await purchaseWithCredits(buy);
        expect(charged).toBe(5.5);
        expect(taxAsked.at(-1)).toMatchObject({ channel: "game", billing: null, ip: null });
        expect(kept?.tax).toMatchObject({ rate: 10, label: { kind: "preset", id: "gst" }, reason: "standard" });
    });
});
