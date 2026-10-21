// @vitest-environment node
/**
 * The checkout asks the same questions the button asked.
 *
 * A window, a per-person limit and a daily allowance are all enforced twice:
 * once where a shopper can see it, so they are told before they try, and once
 * at the till, because the first one runs in a browser and a browser is not
 * something a shop may rely on. `curl` skips the button.
 *
 * The prices work the same way. A scheduled sale changes what the shop shows;
 * a checkout that charged the column instead would take a different amount
 * from the one on the screen, which is the kind of difference a payment
 * provider settles and a customer disputes.
 *
 * The rules themselves are a-product-is-not-always-for-sale.test.ts. This
 * posts to the checkout the way `curl` would and reads what it answers. A
 * credits checkout from an empty wallet is refused with the total it would
 * have taken, which is how the price the till charges is read here without
 * an order being written.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

const ZONE = { current: "Europe/Istanbul" };
const bought = { current: 0 };
const row = { current: {} as Record<string, unknown> };
const orderCreate = vi.fn(async () => ({ id: "o1", orderNumber: "ORD-1" }));

const db = {
    product: { findMany: vi.fn(async () => [row.current]) },
    productVariable: { findMany: vi.fn(async () => []) },
    bulkDiscount: { findMany: vi.fn(async () => []) },
    orderItem: { aggregate: vi.fn(async () => ({ _sum: { quantity: bought.current } })) },
    setting: { findUnique: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({ creditBalance: 0, roleId: null })) },
    order: { create: orderCreate },
    $transaction: vi.fn(),
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logActivity: vi.fn(async () => {}),
    moduleSettings: vi.fn(async () => ({ taxRate: 0, taxIncluded: false, enableCoupons: true })),
    rateLimitForRole: vi.fn(async () => ({ success: true })),
    readJsonBody: (request: Request) => request.json(),
    siteTimeZone: async () => ZONE.current,
    resolveAppUrl: () => "http://localhost",
}));
vi.mock("@/core/sdk", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/core/sdk")>()),
    generateOrderNumber: () => "ORD-1",
    applyFiltersAsync: async (_name: string, value: unknown) => value,
    doActionAsync: async () => {},
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "buyer", role: "member" } }) }));
// What this buyer already owns, for upgrade credit. Nothing, here.
vi.mock("@/modules/store/lib/upgrade-credit-server", () => ({
    creditingPurchases: async () => [],
    ownedRungsOn: async () => [],
}));

const { POST } = await import("@/modules/store/api/checkout/route");

function product(rules: Record<string, unknown> = {}) {
    return {
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
        price: 10,
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
        ...rules,
    };
}

async function checkout() {
    const res = await POST(
        new NextRequest("http://localhost/api/v1/store/checkout", {
            method: "POST",
            body: JSON.stringify({
                items: [{ productId: "p1", quantity: 1 }],
                playerName: "Steve",
                paymentMethod: "credits",
            }),
        }),
    );
    return { status: res.status, body: await res.json() };
}

/** The total an empty wallet was told it needed: the amount the till would take. */
const charged = (body: { error?: string }) => body.error?.match(/need (\d+\.\d{2})/)?.[1];

beforeEach(() => {
    ZONE.current = "Europe/Istanbul";
    bought.current = 0;
    row.current = product();
    orderCreate.mockClear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("the checkout", () => {
    it("takes a product that is for sale as far as the price", async () => {
        const { status, body } = await checkout();
        expect(status).toBe(400);
        expect(charged(body)).toBe("10.00");
    });

    it("refuses a product whose run has not started, and says when it will", async () => {
        row.current = product({ availableFrom: new Date(Date.now() + 86_400_000) });
        const { status, body } = await checkout();
        expect(status).toBe(409);
        expect(body.code).toBe("store_early");
        expect(body.opensAt).toBeTruthy();
        expect(orderCreate).not.toHaveBeenCalled();
    });

    it("refuses over a per-person limit", async () => {
        row.current = product({ perPersonLimit: 1 });
        bought.current = 1;
        const { status, body } = await checkout();
        expect(status).toBe(409);
        expect(body.code).toBe("store_limit_reached");
        expect(orderCreate).not.toHaveBeenCalled();
    });

    it("refuses over the period's allowance", async () => {
        row.current = product({ periodStock: 5 });
        bought.current = 5;
        const { status, body } = await checkout();
        expect(status).toBe(409);
        expect(body.code).toMatch(/^store_sold_out/);
        expect(orderCreate).not.toHaveBeenCalled();
    });

    it("charges the price the sale sets, not the column", async () => {
        row.current = product({ salePrice: 6, saleFrom: new Date(Date.now() - 60_000), saleUntil: null });
        expect(charged((await checkout()).body)).toBe("6.00");
    });

    it("reads the site's clock rather than the server's", async () => {
        // Fridays 18:00 to 22:00. 16:30 UTC is 19:30 in Istanbul, inside the
        // window; the same instant is 12:30 in New York, outside it.
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-09-11T16:30:00Z"));
        row.current = product({ availableDays: [5], availableFromMinute: 18 * 60, availableUntilMinute: 22 * 60 });

        expect((await checkout()).status).toBe(400);

        ZONE.current = "America/New_York";
        const shut = await checkout();
        expect(shut.status).toBe(409);
        expect(shut.body.code).toBe("store_closed");
    });
});

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

const CART = read("module-sources/store/api/cart/route.ts");
const LIST = read("module-sources/store/api/products/route.ts");
/**
 * The product read, which both the page and the endpoint go through. The rules
 * used to be inside the endpoint; the page renders the product on the server
 * now, and two copies of "hide it while it is shut" would be one copy too
 * many.
 */
const DETAIL = read("module-sources/store/lib/read-product.ts");

describe("the screens in front of it", () => {
    it("tell a shopper before they try", () => {
        expect(CART).toContain("availabilityFor(");
        expect(DETAIL).toContain("availabilityFor(");
    });

    it("hide a product an operator asked to hide while it is shut", () => {
        expect(LIST).toContain("hideShut(");
        // The detail answer for one of those is the same as for a product
        // that does not exist, so the two cannot be told apart.
        expect(DETAIL).toContain('outsideWindow === "hidden"');
        // The read says "nothing here" rather than answering itself, and both
        // callers turn that into not found - the endpoint with a 404, the page
        // with `notFound()`. Either way indistinguishable from a product that
        // was never there.
        expect(DETAIL).toMatch(/hidden[\s\S]{0,120}return null/);
        expect(read("module-sources/store/api/products/[id]/route.ts")).toMatch(/!product[\s\S]{0,120}Product not found/);
        expect(read("module-sources/store/pages/public/product/[...params]/page.tsx")).toMatch(/!read[\s\S]{0,40}notFound\(\)/);
    });

    it("carry the state and the sale to the page that draws them", () => {
        expect(LIST).toContain("availability:");
        expect(DETAIL).toContain("availability:");
        expect(LIST).toContain("effectivePrice(");
    });
});
