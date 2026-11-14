// @vitest-environment node
/**
 * The price a campaign puts on the shelf is the price the till takes.
 *
 * The listing priced every card through the running campaigns, and the
 * checkout priced the same product from its own sale window alone. A product
 * the shelf showed at 60 during an event was charged at 100. The buyer gets
 * the lowest offer that applies - the list price, the product's own sale, a
 * running campaign - and the shelf and the till work it out with one function.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

interface CampaignRow {
    isActive: boolean;
    days: number[];
    fromMinute: number | null;
    untilMinute: number | null;
    entries: { productId: string; price: number; stock: number | null }[];
}

const campaigns = { current: [] as CampaignRow[] };
const sale = { current: null as null | { salePrice: number; saleFrom: Date | null; saleUntil: Date | null } };

function productRow() {
    return {
        id: "p1",
        number: 1,
        name: "Rank",
        slug: "rank",
        description: null,
        shortDesc: null,
        image: null,
        images: [],
        comparePrice: null,
        isFeatured: false,
        durationDays: null,
        createdAt: new Date(),
        type: "ONE_TIME",
        categoryId: "c1",
        category: { id: "c1", name: "Ranks", slug: "ranks" },
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
        salePrice: sale.current?.salePrice ?? null,
        saleFrom: sale.current?.saleFrom ?? null,
        saleUntil: sale.current?.saleUntil ?? null,
    };
}

const db = {
    product: {
        // The stock check asks only for products that count their stock, and
        // this one does not.
        findMany: vi.fn(async ({ where }: { where: { stock?: unknown } }) => (where.stock ? [] : [productRow()])),
        findFirst: vi.fn(async () => productRow()),
        count: vi.fn(async () => 1),
    },
    campaign: { findMany: vi.fn(async () => campaigns.current) },
    productVariable: { findMany: vi.fn(async () => []) },
    bulkDiscount: { findMany: vi.fn(async () => []) },
    orderItem: { aggregate: vi.fn(async () => ({ _sum: { quantity: 0 } })) },
    // No store-wide sale runs in these tests.
    storeSale: { findMany: vi.fn(async () => []) },
    setting: {
        findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (where.key === "default_currency" ? { value: "EUR" } : null)),
    },
    user: { findUnique: vi.fn(async () => ({ email: "buyer@example.com", username: "Steve", creditBalance: 0 })) },
    order: { create: vi.fn(async () => ({ id: "o1", orderNumber: "ORD-1" })), update: vi.fn(async () => ({})) },
    cartItem: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(),
};

vi.mock("@/core/sdk/server", async () => {
    const { textContains } = await import("@/core/lib/search-text");
    const { pageParams } = await import("@/core/lib/page-params");
    return {
        ...(await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations")),
        prisma: db,
        textContains,
        pageParams,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        logActivity: vi.fn(async () => {}),
        moduleSettings: vi.fn(async () => ({ taxRate: 0, taxIncluded: false, lowStockAt: 0 })),
        rateLimitForRole: vi.fn(async () => ({ success: true })),
        readJsonBody: (request: Request) => request.json(),
        siteTimeZone: async () => "UTC",
        resolveAppUrl: () => "http://localhost",
        getClientIP: () => "unknown",
    };
});
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

const startPaymentSession = vi.fn(async () => ({
    handled: true,
    redirectUrl: "https://pay.example/checkout",
    reference: "gw-1",
    error: null,
}));
vi.mock("@/modules/store/lib/payments", () => ({
    startPaymentSession: (...args: unknown[]) => startPaymentSession(...(args as [])),
    listPaymentProviders: async () => [{ id: "paypal", label: "PayPal" }],
    isPaymentProviderAvailable: async (id: string) => id === "paypal",
}));

const { POST: checkout } = await import("@/modules/store/api/checkout/route");
const { GET: listProducts } = await import("@/modules/store/api/products/route");
const { readProduct } = await import("@/modules/store/lib/read-product");

/** A campaign open all day, every day, with this product at this price. */
function running(price: number, stock: number | null = null): CampaignRow {
    return { isActive: true, days: [], fromMinute: null, untilMinute: null, entries: [{ productId: "p1", price, stock }] };
}

/**
 * What the shelf's card says the product costs, once the product's own page
 * has been seen to say the same.
 */
async function shelfPrice(): Promise<number> {
    const res = await listProducts(new NextRequest("http://localhost/api/v1/store/products"));
    const body = (await res.json()) as { products: { id: string; price: number }[] };
    const card = body.products.find((product) => product.id === "p1")!.price;
    expect((await readProduct("p1"))?.price).toBe(card);
    return card;
}

/** What the gateway is asked to take for one of it. */
async function charged(): Promise<number> {
    const res = await checkout(
        new NextRequest("http://localhost/api/v1/store/checkout", {
            method: "POST",
            body: JSON.stringify({ items: [{ productId: "p1", quantity: 1 }], playerName: "Steve", paymentMethod: "paypal" }),
        }),
    );
    expect(res.status).toBe(201);
    return (startPaymentSession.mock.calls.at(-1) as unknown as [{ amount: number }])[0].amount;
}

beforeEach(() => {
    vi.clearAllMocks();
    campaigns.current = [];
    sale.current = null;
});

describe("a product in a running campaign", () => {
    it("is charged the campaign price the shelf shows", async () => {
        campaigns.current = [running(60)];
        expect(await shelfPrice()).toBe(60);
        expect(await charged()).toBe(60);
    });

    it("is charged its own sale price when that is lower than the campaign's", async () => {
        sale.current = { salePrice: 50, saleFrom: null, saleUntil: null };
        campaigns.current = [running(60)];
        expect(await shelfPrice()).toBe(50);
        expect(await charged()).toBe(50);
    });

    it("is charged the better of two campaigns that list it", async () => {
        campaigns.current = [running(70), running(55)];
        expect(await shelfPrice()).toBe(55);
        expect(await charged()).toBe(55);
    });

    it("is charged the campaign price whatever stock figure the entry carries, as the shelf shows it", async () => {
        // Nothing counts what sold at a campaign price, so the shelf shows the
        // offer whatever the figure is. A till that stopped at the figure on
        // its own would charge more than the card said.
        campaigns.current = [running(60, 1)];
        expect(await shelfPrice()).toBe(60);
        expect(await charged()).toBe(60);
    });
});

describe("a product outside any running campaign", () => {
    it("is charged the price the shelf shows when the campaign is shut", async () => {
        campaigns.current = [{ ...running(60), isActive: false }];
        expect(await shelfPrice()).toBe(100);
        expect(await charged()).toBe(100);
    });
});
