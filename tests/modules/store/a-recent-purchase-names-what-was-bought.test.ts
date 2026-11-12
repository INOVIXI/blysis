/**
 * The line under a buyer's name in "Recent purchases" is what they bought.
 *
 * It was read off the product the order line points at, and that pointer is
 * empty for a product that has since been deleted and for a line that never
 * had one, so the homepage printed the English word "Unknown" under the
 * buyer's name on a site in any language. The order line keeps the name it
 * was sold under, which is the name the buyer saw at the till.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Line { name: string; product: { name: string; image: string | null } | null }
interface Row { userId: string; total: number; createdAt: Date; user: { username: string; avatar: string | null }; items: Line[] }

const rows: Row[] = [];

/** Hands back only what the route selected, the way Prisma would. */
const findMany = vi.fn(async (args: { select: { items?: { select?: Record<string, unknown> } } }) => {
    const wanted = args.select.items?.select ?? {};
    return rows.map((row) => ({
        ...row,
        items: row.items.map((line) => ({
            ...("name" in wanted ? { name: line.name } : {}),
            ...("product" in wanted ? { product: line.product } : {}),
        })),
    }));
});

// The leaderboards beside the list add each order in its own currency; they
// have nothing to add here.
vi.mock("@/core/sdk/server", () => ({
    isModuleEnabled: vi.fn(async () => true),
    siteCurrency: vi.fn(async () => "USD"),
    prisma: {
        order: { findMany, groupBy: vi.fn(async () => []) },
        creditTopUp: { groupBy: vi.fn(async () => []) },
        user: { findMany: vi.fn(async () => []) },
    },
}));

const { GET } = await import("@/modules/store/api/widget-stats/route");

async function purchases(): Promise<{ username: string; product: string | null; productImage: string | null }[]> {
    const response = await GET();
    return (await response.json()).recentPurchases;
}

function order(lines: Line[]): Row {
    return { userId: "u1", total: 10, createdAt: new Date("2026-11-01T12:00:00Z"), user: { username: "steve", avatar: null }, items: lines };
}

describe("recent purchases", () => {
    beforeEach(() => {
        rows.length = 0;
    });

    it("names the product the way it was sold", () => {
        rows.push(order([{ name: "VIP Rank", product: { name: "VIP Rank", image: "/vip.png" } }]));
        return purchases().then((list) => {
            expect(list[0].product).toBe("VIP Rank");
            expect(list[0].productImage).toBe("/vip.png");
        });
    });

    it("keeps the name of a product that has since been deleted", async () => {
        rows.push(order([{ name: "Winter Crate", product: null }]));
        const list = await purchases();
        expect(list[0].product).toBe("Winter Crate");
        expect(list[0].productImage).toBeNull();
    });

    it("says nothing rather than an English word when an order has no line", async () => {
        rows.push(order([]));
        const list = await purchases();
        expect(list[0].product).toBeNull();
        expect(JSON.stringify(list)).not.toContain("Unknown");
    });
});
