// @vitest-environment node
/**
 * The shop asks what tax a sale carries, and keeps its own answer for when
 * nobody else gives one.
 *
 * The store owned tax outright: one rate, one switch, and a line on the
 * processor's page reading "Tax (20%)" in English whatever the tax is called
 * where the shop is. It now asks the `store.tax` filter with its own answer,
 * so a shop with no tax module charges exactly what it did, and a tax module's
 * answer wins where one is installed. Every place a sale is priced asks the
 * same question - the checkout, paid by gateway or in credits, and a purchase
 * a game makes on a member's behalf - and the order keeps what was answered.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { checkedAnswer, processorTaxLine, readTaxRecord, storeTaxAnswer, taxRecord } from "@/modules/store/lib/tax";
import { computeTotals } from "@/modules/store/lib/pricing";

const listener = { current: null as null | ((own: StoreTaxAnswer, context: StoreTaxContext) => unknown) };
const asked: StoreTaxContext[] = [];
const settings = { current: { taxRate: 20, taxIncluded: false, enableCoupons: true } };
const orderCreate = vi.fn(async () => ({ id: "o1", orderNumber: "ORD-1" }));

const db = {
    // No store-wide sale is running.
    storeSale: { findMany: async () => [] },
    product: {
        findMany: vi.fn(async ({ where }: { where: { stock?: unknown } }) =>
            where.stock
                ? []
                : [
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
                  ],
        ),
    },
    productVariable: { findMany: vi.fn(async () => []) },
    bulkDiscount: { findMany: vi.fn(async () => []) },
    campaign: { findMany: vi.fn(async () => []) },
    orderItem: { aggregate: vi.fn(async () => ({ _sum: { quantity: 0 } })) },
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
    moduleSettings: vi.fn(async () => settings.current),
    rateLimitForRole: vi.fn(async () => ({ success: true })),
    readJsonBody: (request: Request) => request.json(),
    siteTimeZone: async () => "UTC",
    resolveAppUrl: () => "http://localhost",
    getClientIP: (headers: Headers) => headers.get("x-real-ip") ?? "unknown",
}));
vi.mock("@/core/sdk", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/core/sdk")>()),
    generateOrderNumber: () => "ORD-1",
    applyFiltersAsync: async (name: string, value: unknown, context: StoreTaxContext) => {
        if (name === "store.tax") {
            asked.push(context);
            return listener.current ? listener.current(value as StoreTaxAnswer, context) : value;
        }
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
const startPaymentSession = vi.fn(async () => ({ handled: true, redirectUrl: "https://pay.example", reference: "gw-1", error: null }));
vi.mock("@/modules/store/lib/payments", () => ({
    startPaymentSession: (...args: unknown[]) => startPaymentSession(...(args as [])),
    listPaymentProviders: async () => [{ id: "paypal", label: "PayPal" }],
    isPaymentProviderAvailable: async () => true,
}));

const { POST: checkout } = await import("@/modules/store/api/checkout/route");
const { resolveTax } = await import("@/modules/store/lib/tax-server");

const VAT_FR: StoreTaxAnswer = {
    rate: 20,
    included: false,
    label: { kind: "preset", id: "vat" },
    country: "FR",
    reason: "destination",
    evidence: { billingCountry: "FR", ipCountry: "BE", ipMasked: "203.0.113.0", conflict: true },
};

const billing = {
    kind: "individual",
    name: "Ada",
    taxNumber: "",
    taxOffice: "",
    address: "1 Rue",
    city: "Paris",
    country: "fr",
};

function order(paymentMethod: string, headers: Record<string, string> = {}) {
    return checkout(
        new NextRequest("http://localhost/api/v1/store/checkout", {
            method: "POST",
            headers,
            body: JSON.stringify({ items: [{ productId: "p1", quantity: 1 }], playerName: "Steve", paymentMethod, billingDetails: billing }),
        }),
    );
}

type Created = { data: { tax: number; total: number; metadata: { tax: StoreTaxRecord } } };
const created = () => (orderCreate.mock.calls.at(-1) as unknown as [Created])[0].data;

beforeEach(() => {
    vi.clearAllMocks();
    listener.current = null;
    asked.length = 0;
    settings.current = { taxRate: 20, taxIncluded: false, enableCoupons: true };
});

describe("with nothing answering", () => {
    it("charges the store's own rate, as it always did", async () => {
        const answer = await resolveTax({ channel: "game", currency: "EUR", billing: null, ip: null, header: () => null });
        expect(answer).toEqual({
            rate: 20,
            included: false,
            label: { kind: "preset", id: "tax" },
            country: null,
            reason: "standard",
            evidence: null,
        });
    });

    it("keeps the prices-include-tax switch", async () => {
        settings.current = { taxRate: 10, taxIncluded: true, enableCoupons: true };
        expect((await resolveTax({ channel: "game", currency: "EUR", billing: null, ip: null, header: () => null })).included).toBe(true);
    });

    it("calls a shop that charges nothing exempt", () => {
        expect(storeTaxAnswer({ taxRate: 0, taxIncluded: false }, null).reason).toBe("exempt");
    });

    it("names the line on the processor's page as it always did", async () => {
        await order("paypal");
        const lines = (startPaymentSession.mock.calls.at(-1) as unknown as [{ lines: { name: string; unitAmount: number }[] }])[0].lines;
        expect(lines.at(-1)).toEqual({ name: "Tax (20%)", quantity: 1, unitAmount: 20 });
    });
});

describe("with a tax module answering", () => {
    it("charges its rate and keeps its reason and evidence on the order", async () => {
        listener.current = () => ({ ...VAT_FR, rate: 5.5 });
        await order("paypal");
        expect(created().tax).toBe(5.5);
        expect(created().total).toBe(105.5);
        expect(created().metadata.tax).toEqual({
            rate: 5.5,
            included: false,
            label: { kind: "preset", id: "vat" },
            country: "FR",
            reason: "destination",
            billingCountry: "FR",
            ipCountry: "BE",
            ipMasked: "203.0.113.0",
            evidenceConflict: true,
        });
    });

    it("prints the operator's label on the processor's page", async () => {
        listener.current = () => ({ ...VAT_FR, label: { kind: "custom", text: "Consumption tax" }, rate: 10 });
        await order("paypal");
        const lines = (startPaymentSession.mock.calls.at(-1) as unknown as [{ lines: { name: string }[] }])[0].lines;
        expect(lines.at(-1)?.name).toBe("Consumption tax (10%)");
    });

    it("hands it the buyer's billing country, kind and tax number, and the request's address", async () => {
        listener.current = (own) => own;
        await order("paypal", { "x-real-ip": "203.0.113.9", "cf-ipcountry": "BE" });
        const context = asked.at(-1) as StoreTaxContext;
        expect(context.channel).toBe("checkout");
        expect(context.billing).toEqual({ kind: "individual", country: "FR", taxNumber: "" });
        expect(context.ip).toBe("203.0.113.9");
        expect(context.header("cf-ipcountry")).toBe("BE");
    });

    it("applies the zero of an export when the order is paid in credits too", async () => {
        listener.current = () => ({ ...VAT_FR, rate: 0, reason: "export", country: "US" });
        const res = await order("credits");
        // The wallet is empty, so the till says what it would have taken.
        expect((await res.json()).error).toMatch(/need 100\.00/);
    });

    it("is overruled whole when it answers something the store cannot charge", () => {
        const own = storeTaxAnswer({ taxRate: 20, taxIncluded: false }, null);
        expect(checkedAnswer({ ...VAT_FR, rate: 140 }, own)).toBe(own);
        expect(checkedAnswer({ ...VAT_FR, rate: Number.NaN }, own)).toBe(own);
        expect(checkedAnswer({ ...VAT_FR, label: { kind: "custom", text: "  " } }, own)).toBe(own);
        expect(checkedAnswer({ ...VAT_FR, label: { kind: "preset", id: "kdv" } }, own)).toBe(own);
        expect(checkedAnswer(null, own)).toBe(own);
        expect(checkedAnswer({ ...VAT_FR, country: "France" }, own).country).toBeNull();
    });
});

describe("the line a processor prints", () => {
    it("uses the English name of a known label, since it travels with no locale", () => {
        expect(processorTaxLine({ label: { kind: "preset", id: "vat" }, rate: 21 })).toBe("VAT (21%)");
        expect(processorTaxLine({ label: { kind: "preset", id: "sales_tax" }, rate: 8.875 })).toBe("Sales tax (8.875%)");
    });

    it("uses the operator's own words exactly", () => {
        expect(processorTaxLine({ label: { kind: "custom", text: "MwSt." }, rate: 19 })).toBe("MwSt. (19%)");
    });
});

describe("the record on an order", () => {
    it("reads back what was written", () => {
        const record = taxRecord(VAT_FR);
        expect(readTaxRecord({ playerName: "Steve", tax: record })).toEqual(record);
    });

    it("is nothing on an order placed before there was one", () => {
        expect(readTaxRecord({ playerName: "Steve" })).toBeNull();
        expect(readTaxRecord(null)).toBeNull();
    });
});

describe("rounding at a module's rate", () => {
    it("adds tax on top to the cent", () => {
        expect(computeTotals({ subtotal: 9.99, couponDiscount: 0, creatorDiscount: 0, taxRate: 21, taxIncluded: false })).toMatchObject({
            tax: 2.1,
            total: 12.09,
        });
    });

    it("takes the tax out of an inclusive price without losing a cent", () => {
        const { tax, taxableAmount, total } = computeTotals({ subtotal: 9.99, couponDiscount: 0, creatorDiscount: 0, taxRate: 5.5, taxIncluded: true });
        expect(total).toBe(9.99);
        expect(Math.round((taxableAmount + tax) * 100)).toBe(999);
        expect(tax).toBe(0.52);
    });
});
