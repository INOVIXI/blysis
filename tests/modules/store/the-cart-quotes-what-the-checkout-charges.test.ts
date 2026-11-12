// @vitest-environment node
/**
 * The cart quotes what the checkout charges, tax and fee included.
 *
 * A shop that adds tax on top of its prices showed a cart total without it,
 * and worked the payment fee out on that pre-tax total, while the checkout
 * charged the tax and grossed the fee up on the taxed total. The buyer read
 * one figure and the processor's page asked for a larger one. The cart now
 * asks the same `store.tax` filter the checkout asks, through the list of
 * methods it already reads, and works the figures out with the same
 * arithmetic. Until it knows the buyer's country it quotes the shop's default
 * and says the figure can change at checkout.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const feeTable = { current: null as unknown };
const providers = { current: [] as Record<string, unknown>[] };
const rates = { current: {} as Record<string, number> };
/** A tax module answering by the buyer's country, when one is listening. */
const taxModule = { current: null as null | ((own: StoreTaxAnswer, context: StoreTaxContext) => StoreTaxAnswer) };
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
    $transaction: vi.fn(),
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    logActivity: vi.fn(async () => {}),
    moduleSettings: vi.fn(async () => ({ taxRate: 20, taxIncluded: false, enableCoupons: true, creditsPricePerUnit: 0.01 })),
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
        if (name === "store.tax") return taxModule.current ? taxModule.current(value as StoreTaxAnswer, context as unknown as StoreTaxContext) : value;
        return value;
    },
    doActionAsync: async () => {},
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "buyer", role: "member" } }) }));
vi.mock("@/modules/store/lib/upgrade-credit-server", () => ({
    creditingPurchases: async () => [],
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
const { GET: listMethods } = await import("@/modules/store/api/payment-providers/route");
const { checkoutSummary } = await import("@/modules/store/lib/pricing");

interface Quote {
    tax: { rate: number; included: boolean; label: StoreTaxLabel; country: string | null };
    taxCountryKnown: boolean;
    providers: { id: string; fee: { percent: number; fixed: number } | null }[];
}

/** What the cart is told, for a buyer whose country it may or may not know yet. */
async function cartQuote(country?: string): Promise<Quote> {
    const query = country ? `?country=${country}` : "";
    return (await listMethods(new NextRequest(`http://localhost/api/v1/store/payment-providers${query}`))).json();
}

/** The cart's figures, worked out from what it was told with the function it uses. */
function cartAmounts(quote: Quote, method: string, subtotal: number) {
    const fee = quote.providers.find((p) => p.id === method)?.fee ?? null;
    return checkoutSummary({ subtotal, couponDiscount: 0, creatorDiscount: 0, taxRate: quote.tax.rate, taxIncluded: quote.tax.included, fee });
}

type Session = { amount: number; lines: { name: string; unitAmount: number }[] };
const sentToGateway = () => (startPaymentSession.mock.calls.at(-1) as unknown as [Session])[0];

async function pay(method: string, billingCountry?: string) {
    const res = await checkout(
        new NextRequest("http://localhost/api/v1/store/checkout", {
            method: "POST",
            body: JSON.stringify({
                items: [{ productId: "p1", quantity: 1 }],
                playerName: "Steve",
                paymentMethod: method,
                ...(billingCountry
                    ? { billingDetails: { kind: "individual", name: "Ada", taxNumber: "", taxOffice: "", address: "1 Rue", city: "Paris", country: billingCountry } }
                    : {}),
            }),
        }),
    );
    expect(res.status).toBe(201);
    return sentToGateway();
}

beforeEach(() => {
    vi.clearAllMocks();
    rates.current = {};
    taxModule.current = null;
    feeTable.current = { paypal: { passOn: true, percent: 2.9, fixed: 0.3, fixedCurrency: null } };
    providers.current = [{ id: "paypal", label: "PayPal" }];
});

describe("the cart, with tax added on top and a fee passed on", () => {
    it("quotes the tax, the fee on the taxed total, and the total the checkout charges", async () => {
        const cart = cartAmounts(await cartQuote(), "paypal", 100);
        // 100 + 20 tax = 120; (120 + 0.30) / 0.971 = 123.89.
        expect(cart).toMatchObject({ tax: 20, total: 120, surcharge: 3.89, charged: 123.89 });

        const sent = await pay("paypal");
        expect(sent.amount).toBe(cart.charged);
        expect(sent.lines.map((line) => line.unitAmount)).toEqual([100, cart.tax, cart.surcharge]);
    });

    it("agrees with the checkout for a fixed part in another currency too", async () => {
        feeTable.current = { paypal: { passOn: true, percent: 3.49, fixed: 0.49, fixedCurrency: "USD" } };
        rates.current = { "USD>EUR": 0.9 };
        const cart = cartAmounts(await cartQuote(), "paypal", 100);
        expect((await pay("paypal")).amount).toBe(cart.charged);
    });

    it("names the tax line with the label the tax module chose", async () => {
        taxModule.current = (own) => ({ ...own, label: { kind: "custom", text: "KDV" }, rate: 20 });
        const quote = await cartQuote();
        expect(quote.tax).toMatchObject({ rate: 20, included: false, label: { kind: "custom", text: "KDV" } });
        expect((await pay("paypal")).lines[1].name).toBe("KDV (20%)");
    });

    it("quotes the shop's default until the buyer's country is known, and says so", async () => {
        taxModule.current = (own, context) =>
            context.billing?.country === "FR" ? { ...own, rate: 5.5, country: "FR", reason: "destination" } : own;

        const unknown = await cartQuote();
        expect(unknown.taxCountryKnown).toBe(false);
        expect(unknown.tax.rate).toBe(20);

        const known = await cartQuote("fr");
        expect(known.taxCountryKnown).toBe(true);
        const cart = cartAmounts(known, "paypal", 100);
        expect((await pay("paypal", "FR")).amount).toBe(cart.charged);
    });
});
