/**
 * The shop's front can show its best product and a taste of every shelf.
 *
 * The top of the shop listed its sections and nothing in them, so a theme
 * that wanted a showcase, the product the shop is pushing this week, and a
 * row of each shelf under it had nothing to draw them from. These read them
 * the way the shelf itself is read, so a price, a sale and a shut window
 * come out the same on the front as on the shelf: the featured product is the
 * newest one marked featured, each top-level section brings its first few
 * products and its total, a section with nothing on it brings nothing, and a
 * product's page offers the others from its own shelf, never itself.
 */
import { describe, it, expect, vi } from "vitest";

interface Row {
    id: string; number: number; name: string; slug: string; shortDesc: string | null;
    isFeatured: boolean; durationDays: number | null; category: { id: string; name: string; slug: string } | null;
}

function row(over: Partial<Row> & { id: string; category: Row["category"] }): Record<string, unknown> {
    return {
        number: 1, name: over.id, slug: over.id, description: null, shortDesc: null,
        price: 10, comparePrice: null, image: null, images: [], stock: null, isActive: true,
        availableFrom: null, availableUntil: null, availableDays: [], availableFromMinute: null, availableUntilMinute: null,
        outsideWindow: "countdown", roleIds: [], perPersonLimit: null, perPersonPeriod: "ever",
        periodStock: null, periodStockWindow: "day", salePrice: null, saleFrom: null, saleUntil: null,
        isFeatured: false, durationDays: null, createdAt: new Date(),
        ...over,
    };
}

const RANKS = { id: "c-ranks", name: "Rütbeler", slug: "ranks" };
const CRATES = { id: "c-crates", name: "Kasalar", slug: "crates" };

// Newest first, the order the shelf's default sort asks for.
const ROWS = [
    row({ id: "emerald", category: RANKS, isFeatured: true, shortDesc: "Vergisiz pazar.", durationDays: 30 }),
    row({ id: "diamond", category: RANKS }),
    row({ id: "gold", category: RANKS, isFeatured: true }),
    row({ id: "dragon", category: CRATES }),
];

interface Where { category?: { slug: string }; isFeatured?: boolean; id?: { not: string } }
const matches = (where: Where) => (r: Record<string, unknown>) =>
    (!where.category || (r.category as { slug: string } | null)?.slug === where.category.slug)
    && (where.isFeatured === undefined || r.isFeatured === where.isFeatured)
    && (!where.id || r.id !== where.id.not);

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        product: {
            findMany: async ({ where, skip = 0, take }: { where: Where; skip?: number; take?: number }) =>
                ROWS.filter(matches(where)).slice(skip, take === undefined ? undefined : skip + take),
            count: async ({ where }: { where: Where }) => ROWS.filter(matches(where)).length,
        },
    },
    moduleSettings: async () => ({ lowStockAt: 0 }),
    siteTimeZone: async () => "UTC",
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => null }));
vi.mock("@/modules/store/lib/upgrade-credit-server", () => ({ creditingPurchases: async () => new Set<string>() }));
vi.mock("@/modules/store/lib/campaign-server", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/modules/store/lib/campaign-server")>()),
    runningCampaignEntries: async () => [],
}));

const { readFeatured, readShelves, readRelated } = await import("@/modules/store/lib/read-store");

const category = (c: typeof RANKS, parentId: string | null = null) =>
    ({ ...c, image: null, description: null, layout: "grid", parentId, children: [] });

describe("the shop's front", () => {
    it("shows the newest featured product, with the line about it and how long it lasts", async () => {
        const featured = await readFeatured();
        expect(featured?.id).toBe("emerald");
        expect(featured?.shortDesc).toBe("Vergisiz pazar.");
        expect(featured?.durationDays).toBe(30);
    });

    it("gives each top-level section its first products and its total, and skips an empty one", async () => {
        const empty = { id: "c-empty", name: "Boş", slug: "empty" };
        const shelves = await readShelves([category(RANKS), category(CRATES), category(empty), category({ id: "c-sub", name: "Alt", slug: "sub" }, RANKS.id)], 2);
        expect(shelves.map((s) => s.category.slug)).toEqual(["ranks", "crates"]);
        expect(shelves[0].products.map((p) => p.id)).toEqual(["emerald", "diamond"]);
        expect(shelves[0].total).toBe(3);
        expect(shelves[1].products.map((p) => p.id)).toEqual(["dragon"]);
    });
});

describe("a product's page", () => {
    it("offers the others on its own shelf, never itself", async () => {
        const related = await readRelated({ id: "diamond", categorySlug: "ranks" }, 3);
        expect(related.map((p) => p.id)).toEqual(["emerald", "gold"]);
    });

    it("offers nothing for a product with no shelf", async () => {
        expect(await readRelated({ id: "loose", categorySlug: null }, 3)).toEqual([]);
    });
});
