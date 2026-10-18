// @vitest-environment node
/**
 * A per-person limit is about who ends up with the product. A gift bought in
 * game is an order of the sender's that the recipient owns, so it counts
 * against the recipient and not the sender. Counted by the order's buyer, a
 * "one per account" rank could be gifted to the same member again and again,
 * and a member who gave one away could no longer buy their own.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/core/sdk/server", () => ({ prisma: {}, siteTimeZone: async () => "UTC" }));

const { countsFor } = await import("@/modules/store/lib/availability-server");

interface Row {
    productId: string;
    quantity: number;
    order: { status: string; userId: string; createdAt: Date; metadata: Record<string, unknown> | null };
}

/** Answers the few shapes of `where` the counting uses, over rows in memory. */
function matches(where: Record<string, unknown>, row: Row): boolean {
    if (where.productId !== undefined && where.productId !== row.productId) return false;
    const order = (where.order ?? {}) as Record<string, unknown>;
    const status = order.status as { in: string[] } | undefined;
    if (status && !status.in.includes(row.order.status)) return false;
    if (order.userId !== undefined && order.userId !== row.order.userId) return false;
    const created = order.createdAt as { gte: Date } | undefined;
    if (created && row.order.createdAt < created.gte) return false;
    const meta = order.metadata as { path: string[]; equals: unknown } | undefined;
    if (meta) {
        const value = meta.path.reduce<unknown>((at, key) => (at as Record<string, unknown> | null)?.[key], row.order.metadata);
        if (value !== meta.equals) return false;
    }
    for (const key of Object.keys(order)) {
        if (!["status", "userId", "createdAt", "metadata"].includes(key)) throw new Error(`unread filter ${key}`);
    }
    return true;
}

function reader(rows: Row[]) {
    return {
        orderItem: {
            aggregate: async ({ where }: { where: Record<string, unknown> }) => ({
                _sum: { quantity: rows.filter((row) => matches(where, row)).reduce((n, row) => n + row.quantity, 0) || null },
            }),
        },
    };
}

const rules = { perPersonLimit: 1, perPersonPeriod: "ever", periodStock: null, periodStockWindow: "day" } as never;
const now = new Date("2026-10-19T00:00:00Z");
const at = new Date("2026-10-18T12:00:00Z");

const own = (userId: string, status = "COMPLETED"): Row => ({
    productId: "rank",
    quantity: 1,
    order: { status, userId, createdAt: at, metadata: { playerName: "x" } },
});
const gift = (from: string, to: string, status = "COMPLETED"): Row => ({
    productId: "rank",
    quantity: 1,
    order: { status, userId: from, createdAt: at, metadata: { gift: true, recipientId: to } },
});

describe("a per-person limit", () => {
    it("counts a gift against the member who received it", async () => {
        const counts = await countsFor(reader([gift("ada", "bo")]), "rank", "bo", rules, now);
        expect(counts.boughtByPerson).toBe(1);
    });

    it("does not count a gift against the member who sent it", async () => {
        const counts = await countsFor(reader([gift("ada", "bo")]), "rank", "ada", rules, now);
        expect(counts.boughtByPerson).toBe(0);
    });

    it("adds what a member bought and what they were given", async () => {
        const rows = [own("bo"), gift("ada", "bo"), gift("cy", "bo"), own("ada")];
        expect((await countsFor(reader(rows), "rank", "bo", rules, now)).boughtByPerson).toBe(3);
        expect((await countsFor(reader(rows), "rank", "ada", rules, now)).boughtByPerson).toBe(1);
    });

    it("forgets a gift the sender took back", async () => {
        const counts = await countsFor(reader([gift("ada", "bo", "REFUNDED")]), "rank", "bo", rules, now);
        expect(counts.boughtByPerson).toBe(0);
    });

    it("still counts an order with no metadata as the buyer's own", async () => {
        const plain: Row = { productId: "rank", quantity: 2, order: { status: "COMPLETED", userId: "bo", createdAt: at, metadata: null } };
        expect((await countsFor(reader([plain]), "rank", "bo", rules, now)).boughtByPerson).toBe(2);
    });
});
