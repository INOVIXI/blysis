// @vitest-environment node
/**
 * A public product carries the fields a shopper needs, and no others.
 *
 * The public reads asked for the whole row: `include: { category }` and no
 * `select`, so every scalar Prisma knows about went out to anyone. Today that
 * is `deliveryData` - an operator-authored blob nothing in the product reads,
 * so whatever an operator puts there is published - plus `stripePriceId` and
 * two timestamps the page never draws.
 *
 * The size of it is not the point. The point is that the published shape was a
 * consequence of the schema rather than a decision, so the next column added to
 * `Product` would have been public the moment it was added, and the answer is
 * held by a shared cache, so it would have been published to a CDN too.
 *
 * The operator's screen needs the whole row, and asks its own endpoint for it,
 * the same way the operator's listing already does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn(async () => [] as unknown[]);
const findFirst = vi.fn<(args: unknown) => Promise<unknown>>(async () => null);
const count = vi.fn(async () => 0);
let callerIsAdmin = false;

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        product: {
            findMany: (args: unknown) => findMany(args as never),
            findFirst: (args: unknown) => findFirst(args),
            count: (args: unknown) => count(args as never),
        },
    },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    isAdmin: async () => callerIsAdmin,
    // The same caller, asked the newer way: this file is about what a
    // shopper may see, not about which name the check goes by.
    hasPermission: async () => callerIsAdmin,
    pageParams: () => ({ page: 1, limit: 12, skip: 0, take: 12 }),
    readJsonBody: async (request: Request) => request.json(),
    sanitizeHtml: (value: string) => value,
}));
vi.mock("@/core/sdk/auth", () => ({
    auth: async () => (callerIsAdmin ? { user: { id: "admin1" } } : null),
}));

const { GET: LIST } = await import("@/modules/store/api/products/route");
const { GET: ONE } = await import("@/modules/store/api/products/[id]/route");
const { GET: ADMIN_ONE } = await import("@/modules/store/api/admin/products/[id]/route");
const { NextRequest } = await import("next/server");

/** Columns an operator fills in that no shopper has any business reading. */
const OPERATORS_ONLY = ["deliveryData", "stripePriceId", "translations"];

function selectOf(call: unknown): Record<string, unknown> {
    return (call as { select?: Record<string, unknown> }).select ?? {};
}

beforeEach(() => {
    vi.clearAllMocks();
    callerIsAdmin = false;
    findMany.mockResolvedValue([]);
    findFirst.mockResolvedValue(null);
    count.mockResolvedValue(0);
});

describe("the public product listing", () => {
    it("names the columns it publishes rather than taking whatever the schema has", async () => {
        await LIST(new NextRequest("http://example.com/api/v1/store/products"));

        const select = selectOf(findMany.mock.calls[0][0]);
        expect(Object.keys(select).length).toBeGreaterThan(0);
    });

    it("leaves the operator's own columns out of it", async () => {
        await LIST(new NextRequest("http://example.com/api/v1/store/products"));

        const published = Object.keys(selectOf(findMany.mock.calls[0][0]));
        expect(published.filter((c) => OPERATORS_ONLY.includes(c))).toEqual([]);
    });

    it("still carries what the shelf draws", async () => {
        await LIST(new NextRequest("http://example.com/api/v1/store/products"));

        const published = Object.keys(selectOf(findMany.mock.calls[0][0]));
        for (const field of ["id", "number", "name", "slug", "price", "image", "stock", "category"]) {
            expect(published, `the listing draws ${field}`).toContain(field);
        }
    });
});

describe("the public product page", () => {
    it("publishes the same named shape as the listing", async () => {
        findFirst.mockResolvedValue({ id: "p1", isActive: true });
        await ONE(new NextRequest("http://example.com/api/v1/store/products/p1"), {
            params: Promise.resolve({ id: "p1" }),
        });
        await LIST(new NextRequest("http://example.com/api/v1/store/products"));

        expect(Object.keys(selectOf(findFirst.mock.calls[0][0])).sort())
            .toEqual(Object.keys(selectOf(findMany.mock.calls[0][0])).sort());
    });

    it("asks the database for the active one, rather than filtering afterwards", async () => {
        findFirst.mockResolvedValue(null);
        await ONE(new NextRequest("http://example.com/api/v1/store/products/9"), {
            params: Promise.resolve({ id: "9" }),
        });

        expect(findFirst.mock.calls[0][0]).toMatchObject({ where: { isActive: true } });
    });
});

describe("the operator's product endpoint", () => {
    it("hands back the whole row, including what an operator filled in", async () => {
        callerIsAdmin = true;
        findFirst.mockResolvedValue({ id: "p9", deliveryData: { note: "internal" } });

        const response = await ADMIN_ONE(
            new NextRequest("http://example.com/api/v1/store/admin/products/p9"),
            { params: Promise.resolve({ id: "p9" }) },
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.product.deliveryData).toEqual({ note: "internal" });
        expect(selectOf(findFirst.mock.calls[0][0])).toEqual({});
    });

    it("hands back one that is switched off, which is the one an operator opens", async () => {
        callerIsAdmin = true;
        findFirst.mockResolvedValue({ id: "p9", isActive: false });

        const response = await ADMIN_ONE(
            new NextRequest("http://example.com/api/v1/store/admin/products/9"),
            { params: Promise.resolve({ id: "9" }) },
        );

        expect(response.status).toBe(200);
        expect(findFirst.mock.calls[0][0]).not.toMatchObject({ where: { isActive: true } });
    });

    it("is never held by a shared cache, because its answer depends on who asked", async () => {
        callerIsAdmin = true;
        findFirst.mockResolvedValue({ id: "p9" });

        const response = await ADMIN_ONE(
            new NextRequest("http://example.com/api/v1/store/admin/products/p9"),
            { params: Promise.resolve({ id: "p9" }) },
        );

        expect(response.headers.get("Cache-Control")).toContain("no-store");
    });

    it("is refused to a caller who is not an administrator", async () => {
        callerIsAdmin = false;
        findFirst.mockResolvedValue({ id: "p9" });

        const response = await ADMIN_ONE(
            new NextRequest("http://example.com/api/v1/store/admin/products/p9"),
            { params: Promise.resolve({ id: "p9" }) },
        );

        expect(response.status).toBe(401);
        expect(findFirst).not.toHaveBeenCalled();
    });
});
