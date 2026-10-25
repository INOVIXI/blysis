/**
 * A search narrows the shelf; it does not reopen it.
 *
 * The shelf's filter is an `OR`: a product an operator asked to hide outside
 * its dates is left out while it is outside them. The search was spread into
 * the same object as an `OR` of its own and replaced it, so a shopper who
 * typed the product's name found it on sale before its run began.
 */
import { describe, it, expect, vi } from "vitest";

const asked = vi.hoisted(() => ({ where: undefined as unknown }));

vi.mock("@/core/sdk/server", async () => {
    const { textContains } = await import("@/core/lib/search-text");
    return {
        textContains,
        moduleSettings: async () => ({ lowStockAt: 0 }),
        siteTimeZone: async () => "UTC",
        prisma: {
            product: {
                findMany: async (query: { where: unknown }) => { asked.where = query.where; return []; },
                count: async () => 0,
            },
        },
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => null }));
vi.mock("@/modules/store/lib/campaign-server", () => ({
    runningCampaignEntries: async () => [],
    pricedForCampaign: () => ({ price: 0 }),
}));
vi.mock("@/modules/store/lib/upgrade-credit-server", () => ({ creditingPurchases: async () => [] }));

const { readStoreProducts } = await import("@/modules/store/lib/read-store");
const { onTheShelfWhere } = await import("@/modules/store/lib/availability-server");

describe("the shop's search", () => {
    it("keeps a product hidden outside its dates hidden", async () => {
        await readStoreProducts({ search: "altın", sort: "newest", page: 1 });
        const where = asked.where as Record<string, unknown>;
        const shelf = onTheShelfWhere(new Date());
        expect(where.isActive).toBe(true);
        expect(JSON.stringify(Object.keys(where.OR as object[]))).toBe(JSON.stringify(Object.keys(shelf.OR)));
        expect((where.OR as { outsideWindow?: unknown }[])[0]).toEqual({ outsideWindow: { not: "hidden" } });
        expect(where.AND).toEqual([{
            OR: [
                { name: { contains: "altin", mode: "insensitive" } },
                { name: { contains: "altın", mode: "insensitive" } },
                { description: { contains: "altin", mode: "insensitive" } },
                { description: { contains: "altın", mode: "insensitive" } },
            ],
        }]);
    });
});
