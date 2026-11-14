// @vitest-environment node
/**
 * A personal coupon works for the member it was made for and nobody else.
 *
 * A thank-you coupon is printed in an email, which is a code that gets
 * forwarded and posted. Anybody else typing it is told what they would be told
 * for a code that does not exist, by the preview and by the till, so neither
 * can be used to learn that a guessed code is real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const personal = {
    id: "coupon-1",
    code: "THANKS-ABCDEFGHJK",
    isActive: true,
    type: "PERCENTAGE",
    value: 15,
    minPurchase: null,
    maxDiscount: null,
    usageLimit: 1,
    usageCount: 0,
    startsAt: null,
    expiresAt: null,
    productIds: [],
    categoryIds: [],
    userId: "holder",
    issuedForOrderId: "order-0",
};

const session = { current: { user: { id: "holder", role: "member" } } };
const couponClaim = vi.fn(async () => ({ count: 1 }));

const product = {
    id: "p1",
    name: "Rank",
    type: "ONE_TIME",
    categoryId: "c1",
    category: { id: "c1" },
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
    salePrice: null,
    saleFrom: null,
    saleUntil: null,
};

const db = {
    coupon: { findUnique: vi.fn(async () => personal), updateMany: couponClaim },
    cartItem: {
        findMany: vi.fn(async () => [{ quantity: 1, product: { id: "p1", price: 100, categoryId: "c1" } }]),
        deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    product: { findMany: vi.fn(async ({ where }: { where: { stock?: unknown } }) => (where.stock ? [] : [product])) },
    productVariable: { findMany: vi.fn(async () => []) },
    bulkDiscount: { findMany: vi.fn(async () => []) },
    orderItem: { aggregate: vi.fn(async () => ({ _sum: { quantity: 0 } })) },
    // No store-wide sale runs in these tests.
    storeSale: { findMany: vi.fn(async () => []) },
    // No campaign runs in these tests.
    campaign: { findMany: vi.fn(async () => []) },
    setting: { findUnique: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({ email: "buyer@example.com", username: "Steve", creditBalance: 0 })) },
    order: { create: vi.fn(async () => ({ id: "o1", orderNumber: "ORD-1" })), update: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(db)),
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
vi.mock("@/core/sdk/auth", () => ({ auth: async () => session.current }));
vi.mock("@/modules/store/lib/upgrade-credit-server", () => ({
    creditingPurchases: async () => new Set<string>(),
    ownedRungsOn: async () => [],
}));
vi.mock("@/modules/store/lib/order-events", () => ({
    announceOrderCreated: async () => {},
    announceOrderCompleted: async () => {},
}));
vi.mock("@/modules/store/lib/payments", () => ({
    startPaymentSession: async () => ({ handled: true, redirectUrl: "https://pay.example", reference: "gw-1", error: null }),
    listPaymentProviders: async () => [{ id: "stripe", name: "Stripe" }],
    isPaymentProviderAvailable: async () => true,
}));

const { POST: validate } = await import("@/modules/store/api/coupons/validate/route");
const { POST: checkout } = await import("@/modules/store/api/checkout/route");

const preview = () =>
    validate(new NextRequest("http://localhost/api/v1/store/coupons/validate", {
        method: "POST",
        body: JSON.stringify({ code: personal.code }),
    }));

const buy = () =>
    checkout(new NextRequest("http://localhost/api/v1/store/checkout", {
        method: "POST",
        body: JSON.stringify({
            items: [{ productId: "p1", quantity: 1 }],
            playerName: "Steve",
            paymentMethod: "stripe",
            couponCode: personal.code,
        }),
    }));

beforeEach(() => {
    vi.clearAllMocks();
    session.current = { user: { id: "holder", role: "member" } };
});

describe("the coupon preview", () => {
    it("takes the coupon off for the member it was made for", async () => {
        const body = await (await preview()).json();
        expect(body).toMatchObject({ valid: true, coupon: { code: personal.code, discount: 15 } });
    });

    it("answers anybody else as it answers a code that does not exist", async () => {
        session.current = { user: { id: "stranger", role: "member" } };
        const body = await (await preview()).json();
        expect(body).toEqual({ valid: false, code: "coupon_unknown" });
    });
});

describe("the checkout", () => {
    it("charges the holder the discounted price and spends the coupon", async () => {
        const response = await buy();
        expect(response.status).toBe(201);
        expect(couponClaim).toHaveBeenCalledTimes(1);
        expect(db.order.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ discount: 15, total: 85 }) }),
        );
    });

    it("refuses the code to anybody else, spends nothing and places no order", async () => {
        session.current = { user: { id: "stranger", role: "member" } };
        const response = await buy();
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "coupon_unknown", code: "coupon_unknown" });
        expect(couponClaim).not.toHaveBeenCalled();
        expect(db.order.create).not.toHaveBeenCalled();
    });
});
