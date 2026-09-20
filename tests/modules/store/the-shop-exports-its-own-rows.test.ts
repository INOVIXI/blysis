// @vitest-environment node
/**
 * The shop answers for its own tables.
 *
 * The export screen offered products and orders against an endpoint that only
 * knew about members, so two of its three buttons opened a tab showing
 * `{"error":"Invalid type. Use: users"}`. The fix could not be a query written
 * in the export module: `Product` and `Order` are this module's, and a module
 * reading another module's tables is the coupling the hook bus exists to
 * avoid - the same reason the accounting integrator asks `store.orders.collect`
 * rather than reading `Order` itself.
 *
 * So the shop answers. It names the columns its files have, pages in a stable
 * order, and hands cells over rather than text: the escaping, and the guard
 * that keeps a spreadsheet from running a cell as a command, belongs to the
 * one module that writes files.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const product = vi.fn<(args: Record<string, unknown>) => Promise<unknown[]>>(async () => []);
const order = vi.fn<(args: Record<string, unknown>) => Promise<unknown[]>>(async () => []);

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        product: { findMany: (args: Record<string, unknown>) => product(args) },
        order: { findMany: (args: Record<string, unknown>) => order(args) },
    },
}));

const offer = (await import("../../../module-sources/store/hooks/csv-exports")).default;

async function offered(current: unknown[] = []) {
    return offer(current as never, undefined as never);
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("what the shop adds to the export screen", () => {
    it("is its products and its orders", async () => {
        const all = await offered();
        expect(all.map((one) => one.id)).toEqual(["products", "orders"]);
    });

    it("keeps whatever was already offered", async () => {
        const all = await offered([{ id: "users" }]);
        expect(all.map((one) => one.id)).toEqual(["users", "products", "orders"]);
    });

    it("names each one in the shop's own catalogue", async () => {
        const all = await offered();
        for (const one of all) {
            expect(one.labelKey.startsWith("store."), one.id).toBe(true);
        }
    });

    it("is added once, however many times the question is asked", async () => {
        const all = await offered(await offered());
        expect(all.filter((one) => one.id === "products")).toHaveLength(1);
    });
});

describe("how the shop reads a page of them", () => {
    it("asks for the page it was asked for, in an order that does not move", async () => {
        const [products] = await offered();
        await products.read(2000, 500);

        const args = product.mock.calls[0][0];
        expect(args.skip).toBe(2000);
        expect(args.take).toBe(500);
        expect(args.orderBy).toBeTruthy();
    });

    it("names the columns it wants rather than taking the row", async () => {
        const all = await offered();
        await all[0].read(0, 10);
        await all[1].read(0, 10);

        for (const call of [...product.mock.calls, ...order.mock.calls]) {
            expect(call[0].select, "an export names its columns").toBeTruthy();
        }
    });

    it("writes one cell per column of its own header", async () => {
        product.mockResolvedValueOnce([{
            id: "p1", name: "Rank: VIP", slug: "rank-vip", price: 9.5,
            stock: 3, unitsSold: 11, isActive: true, createdAt: new Date("2026-02-03T00:00:00Z"),
        }]);
        const [products] = await offered();
        const rows = await products.read(0, 10);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveLength(products.header.length);
    });

    it("writes an order's own numbers rather than an object a reader cannot use", async () => {
        order.mockResolvedValueOnce([{
            id: "o1", orderNumber: "ORD-1", status: "COMPLETED", total: 12.5,
            currency: "USD", createdAt: new Date("2026-02-03T00:00:00Z"),
            user: { username: "aeryn", email: "a@example.invalid" },
        }]);
        const all = await offered();
        const rows = await all[1].read(0, 10);

        expect(rows[0]).toHaveLength(all[1].header.length);
        expect(rows[0].some((cell) => typeof cell === "object" && cell !== null && !(cell instanceof Date))).toBe(false);
    });

    it("says who the buyer was without inventing one for a guest order", async () => {
        order.mockResolvedValueOnce([{
            id: "o2", orderNumber: "ORD-2", status: "PENDING", total: 1,
            currency: "USD", createdAt: new Date("2026-02-03T00:00:00Z"), user: null,
        }]);
        const all = await offered();
        const rows = await all[1].read(0, 10);

        expect(rows[0]).toContain("");
    });
});
