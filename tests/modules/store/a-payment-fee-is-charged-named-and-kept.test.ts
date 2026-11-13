// @vitest-environment node
/**
 * A fee passed on is charged, named on the gateway's page and kept on the row.
 *
 * The fee rules are every-payment-method-can-pass-its-fee-on.test.ts. This
 * posts to the three places money is asked for - an order's checkout, a
 * wallet top-up and the list of methods the cart draws - and reads what each
 * hands on. They used to disagree: an order grossed up for Stripe's fee and a
 * top-up through the same Stripe did not, so the same processor cost the shop
 * its cut on one and not on the other. And nothing kept the fee anywhere but
 * the amount sent to the gateway, so a revenue report could not tell what was
 * sold from what the processor was paid.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const feeTable = { current: null as unknown };
const providers = { current: [] as Record<string, unknown>[] };
const rates = { current: {} as Record<string, number> };
const orderUpdate = vi.fn(async () => ({}));
const topUpCreate = vi.fn(async () => ({ id: "topup-1" }));

const db = {
    product: {
        // The stock check asks only for products that count their stock, and
        // this one does not.
        findMany: vi.fn(async ({ where }: { where: { stock?: unknown } }) => where.stock ? [] : [
            {
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
            },
        ]),
    },
    productVariable: { findMany: vi.fn(async () => []) },
    bulkDiscount: { findMany: vi.fn(async () => []) },
    orderItem: { aggregate: vi.fn(async () => ({ _sum: { quantity: 0 } })) },
    setting: {
        findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
            if (where.key === "default_currency") return { value: "EUR" };
            if (where.key === "store_payment_fees") return feeTable.current === null ? null : { value: feeTable.current };
            return null;
        }),
    },
    user: { findUnique: vi.fn(async () => ({ email: "buyer@example.com", username: "Steve", creditBalance: 0 })) },
    order: { create: vi.fn(async () => ({ id: "o1", orderNumber: "ORD-1" })), update: orderUpdate },
    cartItem: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    creditPackage: {
        findUnique: vi.fn(async () => ({ id: "pack-1", name: "Big pack", credits: 1000, bonusCredits: 0, price: 50, isActive: true })),
    },
    creditTopUp: { create: topUpCreate },
    // No bonus campaign runs here: the fee is what is being read.
    creditBonusCampaign: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(),
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    logActivity: vi.fn(async () => {}),
    moduleSettings: vi.fn(async () => ({ taxRate: 0, taxIncluded: false, enableCoupons: true, creditsPricePerUnit: 0.01 })),
    rateLimitForRole: vi.fn(async () => ({ success: true })),
    readJsonBody: (request: Request) => request.json(),
    siteTimeZone: async () => "UTC",
    resolveAppUrl: () => "http://localhost",
    getClientIP: () => "unknown",
}));
vi.mock("@/core/sdk", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/core/sdk")>()),
    generateOrderNumber: () => "ORD-1",
    applyFiltersAsync: async (name: string, value: unknown, context: { from?: string; to?: string }) => {
        if (name === "currency.rate") return rates.current[`${context.from}>${context.to}`.toUpperCase()] ?? null;
        return value;
    },
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

const startPaymentSession = vi.fn(async () => ({
    handled: true,
    redirectUrl: "https://pay.example/checkout",
    reference: "gw-1",
    error: null,
}));
vi.mock("@/modules/store/lib/payments", () => ({
    startPaymentSession: (...args: unknown[]) => startPaymentSession(...(args as [])),
    listPaymentProviders: async () => providers.current,
    isPaymentProviderAvailable: async (id: string) => providers.current.some((p) => p.id === id),
}));

const { POST: checkout } = await import("@/modules/store/api/checkout/route");
const { POST: buyCredits } = await import("@/modules/store/api/credits/buy/route");
const { GET: listMethods } = await import("@/modules/store/api/payment-providers/route");

function post(handler: (request: NextRequest) => Promise<Response>, url: string, body: Record<string, unknown>) {
    return handler(new NextRequest(url, { method: "POST", body: JSON.stringify(body) }));
}

const order = (paymentMethod: string) =>
    post(checkout, "http://localhost/api/v1/store/checkout", {
        items: [{ productId: "p1", quantity: 1 }],
        playerName: "Steve",
        paymentMethod,
    });

const topUp = (provider: string) =>
    post(buyCredits, "http://localhost/api/v1/store/credits/buy", { packageId: "pack-1", provider });

type Session = { amount: number; lines: { name: string; unitAmount: number }[] };
const sentToGateway = () => (startPaymentSession.mock.calls.at(-1) as unknown as [Session])[0];

beforeEach(() => {
    vi.clearAllMocks();
    feeTable.current = null;
    rates.current = {};
    providers.current = [
        { id: "stripe", label: "Stripe", passOnFee: { percent: 2.9, fixed: 0.3 } },
        { id: "paypal", label: "PayPal" },
    ];
});

describe("an order", () => {
    it("keeps a gateway's own fee where the operator has not set one", async () => {
        const res = await order("stripe");
        expect(res.status).toBe(201);
        const sent = sentToGateway();
        // (100 + 0.30) / 0.971
        expect(sent.amount).toBe(103.3);
        expect(sent.lines.at(-1)).toMatchObject({ unitAmount: 3.3 });
        expect(orderUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ chargeAmount: 103.3, paymentFee: 3.3 }) }),
        );
    });

    it("passes on a fee for a method that offers none, from the operator's table", async () => {
        feeTable.current = { paypal: { passOn: true, percent: 3.49, fixed: 0.49, fixedCurrency: null } };
        await order("paypal");
        // (100 + 0.49) / 0.9651
        expect(sentToGateway().amount).toBe(104.12);
        expect(orderUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ paymentFee: 4.12 }) }),
        );
    });

    it("charges no fee where the operator switched Stripe's off", async () => {
        feeTable.current = { stripe: { passOn: false, percent: 0, fixed: 0, fixedCurrency: null } };
        await order("stripe");
        expect(sentToGateway().amount).toBe(100);
        expect(sentToGateway().lines).toHaveLength(1);
    });

    it("converts a fixed part in another currency into the order's before grossing up", async () => {
        feeTable.current = { paypal: { passOn: true, percent: 2, fixed: 1, fixedCurrency: "USD" } };
        rates.current = { "USD>EUR": 0.9 };
        await order("paypal");
        // (100 + 0.90) / 0.98
        expect(sentToGateway().amount).toBe(102.96);
    });

    it("converts into the gateway's currency once, after the fee", async () => {
        // The fixed part is USD, the shop is EUR, the gateway settles in TRY.
        // Converting the fee straight into TRY and then the total again would
        // count the fee's conversion twice.
        feeTable.current = { paypal: { passOn: true, percent: 2, fixed: 1, fixedCurrency: "USD" } };
        rates.current = { "USD>EUR": 0.9, "EUR>TRY": 40 };
        providers.current = [{ id: "paypal", label: "PayPal", settlesIn: "TRY" }];
        await order("paypal");
        expect(sentToGateway().amount).toBe(4118.4);
        expect(orderUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ paymentFee: 2.96, chargeAmount: 4118.4, chargeCurrency: "TRY" }) }),
        );
    });

    it("refuses to start a payment whose fixed fee cannot be converted", async () => {
        feeTable.current = { paypal: { passOn: true, percent: 2, fixed: 1, fixedCurrency: "USD" } };
        const res = await order("paypal");
        expect(res.status).toBe(503);
        expect((await res.json()).code).toBe("fee_rate_unavailable");
        expect(startPaymentSession).not.toHaveBeenCalled();
    });
});

describe("a wallet top-up", () => {
    it("is grossed up through the same rule an order is", async () => {
        feeTable.current = { paypal: { passOn: true, percent: 3.49, fixed: 0.49, fixedCurrency: null } };
        const res = await topUp("paypal");
        expect(res.status).toBe(200);
        // (50 + 0.49) / 0.9651
        expect(sentToGateway().amount).toBe(52.32);
        expect(sentToGateway().lines.at(-1)).toMatchObject({ unitAmount: 2.32 });
        expect(topUpCreate).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ amount: 50, fee: 2.32 }) }),
        );
    });

    it("keeps a gateway's own fee too", async () => {
        await topUp("stripe");
        // (50 + 0.30) / 0.971
        expect(sentToGateway().amount).toBe(51.8);
    });

    it("refuses rather than guesses a fixed fee it cannot convert", async () => {
        feeTable.current = { paypal: { passOn: true, percent: 2, fixed: 1, fixedCurrency: "USD" } };
        const res = await topUp("paypal");
        expect(res.status).toBe(503);
        expect((await res.json()).code).toBe("fee_rate_unavailable");
        expect(topUpCreate).not.toHaveBeenCalled();
    });
});

describe("the list the cart draws", () => {
    it("tells the buyer each method's fee in the shop's currency before they pay", async () => {
        feeTable.current = { paypal: { passOn: true, percent: 2, fixed: 1, fixedCurrency: "USD" } };
        rates.current = { "USD>EUR": 0.9 };
        const res = await listMethods(new NextRequest("http://localhost/api/v1/store/payment-providers"));
        const body = await res.json();
        const byId = Object.fromEntries(body.providers.map((p: { id: string }) => [p.id, p]));
        expect(byId.stripe.fee).toEqual({ percent: 2.9, fixed: 0.3 });
        expect(byId.paypal.fee).toEqual({ percent: 2, fixed: 0.9 });
    });

    it("says a method cannot be used when its fee cannot be converted", async () => {
        feeTable.current = { paypal: { passOn: true, percent: 2, fixed: 1, fixedCurrency: "USD" } };
        const body = await (await listMethods(new NextRequest("http://localhost/api/v1/store/payment-providers"))).json();
        const paypal = body.providers.find((p: { id: string }) => p.id === "paypal");
        expect(paypal.fee).toBeNull();
        expect(paypal.unavailable).toBe("fee_rate_unavailable");
    });
});
