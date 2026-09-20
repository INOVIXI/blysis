// @vitest-environment node
/**
 * A category drawn as a comparison is still the shelf.
 *
 * Ranks, plans and tiers are compared rather than browsed, so a category may
 * say it is a ladder and hand itself to whatever module draws comparisons.
 * The danger in that hand-off is a second route to the same products: a table
 * built from rows an operator typed goes stale the day a price changes, and a
 * table built from the database without the shelf's own rules shows what the
 * grid is careful to hide.
 *
 * So the columns come from the shop, at the moment the page is drawn, through
 * the same availability rules the grid applies - and the hook answers for the
 * shop's own categories only, because a filter that fires on somebody else's
 * subject is a module reaching into a conversation it was not part of.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn<(args: unknown) => Promise<unknown[]>>(async () => []);

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        product: { findMany: (args: unknown) => findMany(args) },
        // No campaign is running, so a column's price is the shelf's own.
        campaign: { findMany: async () => [] },
    },
    siteTimeZone: async () => "UTC",
    moduleSettings: async () => ({ lowStockAt: 0 }),
}));
vi.mock("next-intl/server", () => ({
    getTranslations: async () => (key: string) => key,
}));

const { categoryIdIn, CATEGORY_SUBJECT } = await import("@/modules/store/lib/comparison-subject");
const columns = (await import("@/modules/store/hooks/comparison-columns")).default;

/** A row as `PUBLIC_PRODUCT` selects it, with nothing shut and no schedule. */
function product(over: Partial<Record<string, unknown>> = {}) {
    return {
        id: "p1", number: 1, name: "VIP", slug: "vip",
        price: 9.99, comparePrice: null, image: null, stock: null, isFeatured: false,
        isActive: true, roleIds: [], requiresProductIds: [], requiresAny: false,
        availableFrom: null, availableUntil: null, availableDays: [],
        availableFromMinute: null, availableUntilMinute: null, outsideWindow: "shown",
        perPersonLimit: null, perPersonPeriod: "forever",
        periodStock: null, periodStockWindow: "forever",
        salePrice: null, saleFrom: null, saleUntil: null,
        ...over,
    };
}

/** What the hook returns for one shelf, as a comparison asks for it. */
async function columnsFor(subjectRef: string) {
    return (await columns([], { subjectRef } as never)) as {
        ref: string; label: string; price: number; href: string;
    }[];
}

beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([]);
});

describe("a subject reference", () => {
    it("names the category inside it", () => {
        expect(categoryIdIn(`${CATEGORY_SUBJECT}:cat1`)).toBe("cat1");
    });

    it("is not answered when it belongs to another module", () => {
        expect(categoryIdIn("hosting.plan:cat1")).toBeNull();
    });

    it("is not answered when it names no category at all", () => {
        expect(categoryIdIn(`${CATEGORY_SUBJECT}:`)).toBeNull();
    });
});

describe("the columns of a comparison", () => {
    it("are not read from the database for somebody else's subject", async () => {
        expect(await columnsFor("hosting.plan:cat1")).toEqual([]);
        expect(findMany).not.toHaveBeenCalled();
    });

    it("are one per product on the shelf", async () => {
        findMany.mockResolvedValue([
            product({ id: "p1", number: 1, name: "VIP", slug: "vip", price: 9.99 }),
            product({ id: "p2", number: 2, name: "VIP+", slug: "vip-plus", price: 19.99 }),
        ]);

        const drawn = await columnsFor(`${CATEGORY_SUBJECT}:cat1`);

        expect(drawn.map((column) => column.label)).toEqual(["VIP", "VIP+"]);
        expect(drawn.map((column) => column.price)).toEqual([9.99, 19.99]);
    });

    it("ask the database for what is on the shelf rather than for everything", async () => {
        await columnsFor(`${CATEGORY_SUBJECT}:cat1`);

        const where = (findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
        expect(where).toMatchObject({ isActive: true, categoryId: "cat1" });
    });

    it("leave out a product whose window is shut, exactly as the grid does", async () => {
        findMany.mockResolvedValue([
            product({ id: "p1", name: "VIP" }),
            product({
                id: "p2", name: "Winter Sale", slug: "winter",
                availableUntil: new Date("2020-01-01T00:00:00Z"),
                outsideWindow: "hidden",
            }),
        ]);

        const drawn = await columnsFor(`${CATEGORY_SUBJECT}:cat1`);

        expect(drawn.map((column) => column.label)).toEqual(["VIP"]);
    });

    it("point at the product's own page", async () => {
        findMany.mockResolvedValue([product({ number: 7, slug: "vip" })]);

        expect((await columnsFor(`${CATEGORY_SUBJECT}:cat1`))[0].href).toBe("/store/product/7/vip");
    });
});
