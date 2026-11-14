// @vitest-environment node
/**
 * A store-wide sale is the price the shop takes, not only the one it shows.
 *
 * An operator sets "20% off everything this weekend" once, and every product
 * covered by it is that much cheaper on the card, in the cart and at the
 * till. Where a product is already cheaper on its own sale or a campaign, the
 * lower price wins and the two are never added together; where two store
 * sales cover one product, the larger percent applies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const sales = { current: [] as Record<string, unknown>[] };
const shelves = { current: [] as { id: string; parentId: string | null }[] };
const product = {
    id: "p1",
    name: "Rank",
    type: "ONE_TIME",
    categoryId: "ranks",
    category: { id: "ranks" },
    isActive: true,
    roleIds: [],
    requiresProductIds: [],
    requiresAny: false,
    stock: null,
    price: 100,
    availableFrom: null,
    availableUntil: null,
    availableDays: [],
    availableFromMinute: null,
    availableUntilMinute: null,
    outsideWindow: "countdown",
    perPersonLimit: null,
    perPersonPeriod: "ever",
    periodStock: null,
    periodStockWindow: "day",
    salePrice: null as number | null,
    saleFrom: null,
    saleUntil: null,
};
const orderCreate = vi.fn(async (_args: { data: { total: number; subtotal: number } }) => ({ id: "o1", orderNumber: "ORD-1" }));

const db = {
    product: {
        findMany: vi.fn(async ({ where }: { where: { stock?: unknown } }) => (where.stock ? [] : [product])),
    },
    storeSale: {
        // The where clause is the database's half of the window; the rule
        // re-checks it, so handing back every row tests that half too.
        findMany: vi.fn(async () => sales.current),
    },
    category: { findMany: vi.fn(async () => shelves.current) },
    productVariable: { findMany: vi.fn(async () => []) },
    bulkDiscount: { findMany: vi.fn(async () => []) },
    orderItem: { aggregate: vi.fn(async () => ({ _sum: { quantity: 0 } })) },
    // No campaign runs in these tests.
    campaign: { findMany: vi.fn(async () => []) },
    setting: {
        findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (where.key === "default_currency" ? { value: "EUR" } : null)),
    },
    user: { findUnique: vi.fn(async () => ({ email: "buyer@example.com", username: "Steve", creditBalance: 0 })) },
    order: { create: orderCreate, update: vi.fn(async () => ({})) },
    cartItem: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(),
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    logActivity: vi.fn(async () => {}),
    moduleSettings: vi.fn(async () => ({ taxRate: 0, taxIncluded: false, enableCoupons: true })),
    rateLimitForRole: vi.fn(async () => ({ success: true })),
    readJsonBody: (request: Request) => request.json(),
    siteTimeZone: async () => "UTC",
    resolveAppUrl: () => "http://localhost",
    getClientIP: () => "unknown",
}));
vi.mock("@/core/sdk", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/core/sdk")>()),
    generateOrderNumber: () => "ORD-1",
    applyFiltersAsync: async (_name: string, value: unknown) => value,
    doActionAsync: async () => {},
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "buyer", role: "member" } }) }));
vi.mock("@/modules/store/lib/upgrade-credit-server", () => ({
    creditingPurchases: async () => new Set<string>(),
    ownedRungsOn: async () => [],
}));
vi.mock("@/modules/store/lib/order-events", () => ({
    announceOrderCreated: async () => {},
    announceOrderCompleted: async () => {},
}));

const startPaymentSession = vi.fn(async (_input: { amount: number }) => ({
    handled: true,
    redirectUrl: "https://pay.example/checkout",
    reference: "gw-1",
    error: null,
}));
vi.mock("@/modules/store/lib/payments", () => ({
    startPaymentSession: (input: { amount: number }) => startPaymentSession(input),
    listPaymentProviders: async () => [{ id: "paypal", label: "PayPal" }],
    isPaymentProviderAvailable: async () => true,
}));

const { withStoreSale, salePercentFor } = await import("@/modules/store/lib/store-sale");
const { runningStoreSales } = await import("@/modules/store/lib/store-sale-server");
const { POST: checkout } = await import("@/modules/store/api/checkout/route");

const NOW = new Date("2026-11-20T12:00:00Z");
const DAY = 86_400_000;

function sale(over: Partial<{ id: string; percent: number; categoryIds: string[]; startsAt: Date; endsAt: Date; isActive: boolean }> = {}) {
    return {
        id: "s1",
        name: "Weekend",
        percent: 20,
        categoryIds: [] as string[],
        startsAt: new Date(NOW.getTime() - DAY),
        endsAt: new Date(NOW.getTime() + DAY),
        isActive: true,
        ...over,
    };
}

const full = { price: 100, was: null, onSale: false };

describe("the rule", () => {
    it("takes the percent off the list price", () => {
        expect(withStoreSale(full, { listPrice: 100, categoryId: "ranks" }, [sale()], NOW)).toEqual({ price: 80, was: 100, onSale: true });
    });

    it("keeps a product's own sale when it is lower, and never adds the two", () => {
        const ownSale = { price: 50, was: 100, onSale: true };
        expect(withStoreSale(ownSale, { listPrice: 100, categoryId: "ranks" }, [sale()], NOW)).toBe(ownSale);
    });

    it("beats a product's own sale when it is lower, and strikes through the list price", () => {
        const ownSale = { price: 90, was: 100, onSale: true };
        expect(withStoreSale(ownSale, { listPrice: 100, categoryId: "ranks" }, [sale({ percent: 25 })], NOW)).toEqual({ price: 75, was: 100, onSale: true });
    });

    it("gives the larger percent when two sales cover one product", () => {
        const both = [sale({ id: "a", percent: 10 }), sale({ id: "b", percent: 30, categoryIds: ["ranks"] })];
        expect(salePercentFor(both, "ranks", NOW)).toBe(30);
        expect(withStoreSale(full, { listPrice: 100, categoryId: "ranks" }, both, NOW).price).toBe(70);
        // A shelf the second one does not name has only the first.
        expect(salePercentFor(both, "keys", NOW)).toBe(10);
    });

    it("covers only the chosen shelves when it names some", () => {
        const ranks = [sale({ categoryIds: ["ranks"] })];
        expect(withStoreSale(full, { listPrice: 100, categoryId: "keys" }, ranks, NOW)).toBe(full);
        expect(withStoreSale(full, { listPrice: 100, categoryId: null }, ranks, NOW)).toBe(full);
    });

    it("does nothing before it starts, from the instant it ends, or while switched off", () => {
        const before = sale({ startsAt: new Date(NOW.getTime() + 1) });
        const ended = sale({ endsAt: NOW });
        const off = sale({ isActive: false });
        for (const one of [before, ended, off]) {
            expect(withStoreSale(full, { listPrice: 100, categoryId: "ranks" }, [one], NOW)).toBe(full);
        }
        expect(withStoreSale(full, { listPrice: 100, categoryId: "ranks" }, [sale({ startsAt: NOW })], NOW).price).toBe(80);
    });

    it("rounds to the cent", () => {
        expect(withStoreSale({ price: 9.99, was: null, onSale: false }, { listPrice: 9.99, categoryId: null }, [sale({ percent: 33 })], NOW).price).toBe(6.69);
    });

    it("never takes more than the ceiling, whatever a row says", () => {
        expect(withStoreSale(full, { listPrice: 100, categoryId: null }, [sale({ percent: 100 })], NOW).price).toBe(10);
    });
});

describe("the sales running now", () => {
    beforeEach(() => {
        sales.current = [];
        shelves.current = [];
    });

    it("widens a chosen shelf to the shelves under it", async () => {
        sales.current = [sale({ categoryIds: ["ranks"] })];
        shelves.current = [
            { id: "ranks", parentId: null },
            { id: "vip", parentId: "ranks" },
            { id: "vip-plus", parentId: "vip" },
            { id: "keys", parentId: null },
        ];
        const [running] = await runningStoreSales(NOW);
        expect(running.categoryIds.sort()).toEqual(["ranks", "vip", "vip-plus"]);
    });

    it("leaves out a row the window does not hold", async () => {
        sales.current = [sale({ endsAt: NOW })];
        expect(await runningStoreSales(NOW)).toEqual([]);
    });
});

describe("the checkout", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(NOW);
        sales.current = [];
        shelves.current = [];
        product.salePrice = null;
    });

    async function pay() {
        const res = await checkout(
            new NextRequest("http://localhost/api/v1/store/checkout", {
                method: "POST",
                body: JSON.stringify({ items: [{ productId: "p1", quantity: 2 }], playerName: "Steve", paymentMethod: "paypal" }),
            }),
        );
        expect(res.status).toBe(201);
        return {
            order: orderCreate.mock.calls.at(-1)?.[0].data,
            sent: startPaymentSession.mock.calls.at(-1)?.[0],
        };
    }

    it("charges the sale price, in the order it writes and the amount it asks for", async () => {
        sales.current = [sale({ percent: 25 })];
        const { order, sent } = await pay();
        expect(Number(order?.subtotal)).toBe(150);
        expect(Number(order?.total)).toBe(150);
        expect(sent?.amount).toBe(150);
    });

    it("charges the list price once the sale is over", async () => {
        sales.current = [sale({ percent: 25, endsAt: NOW })];
        const { sent } = await pay();
        expect(sent?.amount).toBe(200);
    });

    it("charges the product's own sale when it is the lower one", async () => {
        product.salePrice = 60;
        sales.current = [sale({ percent: 25 })];
        const { sent } = await pay();
        expect(sent?.amount).toBe(120);
    });
});
