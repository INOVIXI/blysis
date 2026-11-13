// @vitest-environment node
/**
 * With the credits-only setting on, an order is paid from the balance or not
 * at all.
 *
 * The cart stops drawing the gateways in this mode, but a request is not a
 * cart: anybody can post a checkout naming Stripe. So the checkout refuses a
 * gateway itself, for a free order as much as a paid one, and refuses a
 * subscription, which renews through a gateway. With the setting off nothing
 * changes. The balance path is still the one every credits order takes, and
 * when it falls short it says so with a code the cart can turn into a link to
 * the top-up page.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const settings = { current: {} as Record<string, unknown> };
const product = { current: { type: "ONE_TIME", price: 100 } };
const balance = { current: 0 };

const db = {
    product: {
        findMany: vi.fn(async ({ where }: { where: { stock?: unknown } }) => where.stock ? [] : [
            {
                id: "p1",
                name: "Rank",
                type: product.current.type,
                categoryId: "c1",
                category: { id: "c1" },
                isActive: true,
                roleIds: [],
                requiresProductIds: [],
                requiresAny: false,
                stock: null,
                price: product.current.price,
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
                salePrice: null,
                saleFrom: null,
                saleUntil: null,
            },
        ]),
    },
    productVariable: { findMany: vi.fn(async () => []) },
    bulkDiscount: { findMany: vi.fn(async () => []) },
    orderItem: { aggregate: vi.fn(async () => ({ _sum: { quantity: 0 } })) },
    setting: {
        findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (where.key === "default_currency" ? { value: "TRY" } : null)),
    },
    user: { findUnique: vi.fn(async () => ({ email: "buyer@example.com", username: "Steve", creditBalance: balance.current })) },
    order: { create: vi.fn(async () => ({ id: "o1", orderNumber: "ORD-1" })), update: vi.fn(async () => ({})) },
    cartItem: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(),
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    logActivity: vi.fn(async () => {}),
    moduleSettings: vi.fn(async () => ({ taxRate: 0, taxIncluded: false, enableCoupons: true, ...settings.current })),
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

const startPaymentSession = vi.fn(async () => ({ handled: true, redirectUrl: "https://pay.example/checkout", reference: "gw-1", error: null }));
vi.mock("@/modules/store/lib/payments", () => ({
    startPaymentSession: (...args: unknown[]) => startPaymentSession(...(args as [])),
    listPaymentProviders: async () => [{ id: "stripe", label: "Stripe" }],
    isPaymentProviderAvailable: async () => true,
}));

const { POST: checkout } = await import("@/modules/store/api/checkout/route");

const order = (paymentMethod: string) =>
    checkout(new NextRequest("http://localhost/api/v1/store/checkout", {
        method: "POST",
        body: JSON.stringify({ items: [{ productId: "p1", quantity: 1 }], playerName: "Steve", paymentMethod }),
    }));

beforeEach(() => {
    vi.clearAllMocks();
    settings.current = { creditsOnlyStore: true };
    product.current = { type: "ONE_TIME", price: 100 };
    balance.current = 0;
});

describe("a credits-only store", () => {
    it("refuses an order sent to a gateway, before any order or payment exists", async () => {
        const res = await order("stripe");
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: "store_credits_only" });
        expect(db.order.create).not.toHaveBeenCalled();
        expect(startPaymentSession).not.toHaveBeenCalled();
    });

    it("refuses a gateway for a free order too, so no total opens the door", async () => {
        product.current = { type: "ONE_TIME", price: 0 };
        const res = await order("stripe");
        expect(await res.json()).toMatchObject({ code: "store_credits_only" });
        expect(db.order.create).not.toHaveBeenCalled();
    });

    it("refuses a subscription, which would renew through a gateway", async () => {
        product.current = { type: "SUBSCRIPTION", price: 100 };
        const res = await order("stripe");
        expect(await res.json()).toMatchObject({ code: "store_credits_only_subscription" });
    });

    it("takes the order to the balance, which says what is missing when it falls short", async () => {
        balance.current = 40;
        const res = await order("credits");
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: "store_insufficient_credits", missing: 60 });
        expect(startPaymentSession).not.toHaveBeenCalled();
    });
});

describe("a store with the setting off", () => {
    it("still sends an order to the gateway the buyer picked", async () => {
        settings.current = {};
        const res = await order("stripe");
        expect(res.status).toBe(201);
        expect(startPaymentSession).toHaveBeenCalledTimes(1);
    });
});
