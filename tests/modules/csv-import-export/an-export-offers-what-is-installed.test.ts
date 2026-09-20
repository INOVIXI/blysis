// @vitest-environment node
/**
 * The export screen offers what this site can actually export.
 *
 * Measured on 2026-09-20 against a seeded install: the screen drew three
 * buttons - products, orders, users - and the endpoint behind them answered
 * `{"error":"Invalid type. Use: users"}` to two of the three. Pressing either
 * opened a new tab showing that JSON. The module could not have done better on
 * its own: `Product` and `Order` belong to the shop, and a module reading
 * another module's tables is the coupling the hook bus exists to avoid.
 *
 * So the question is asked rather than assumed. This module offers the members
 * - core's own table, which is always there - and anything installed adds its
 * own. A type nobody offered is refused without a read, which is what the
 * screen's third button used to get.
 *
 * The escaping stays here rather than travelling with each answer: a
 * contributor that forgot the formula guard would turn its own export into a
 * spreadsheet that runs commands, and that is not a mistake to leave
 * available.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn<(args: Record<string, unknown>) => Promise<unknown[]>>(async () => []);
const logActivity = vi.fn(async () => undefined);
let callerIsAdmin = true;

/** What the installed modules answer with, beside this module's own. */
let contributed: unknown[] = [];

vi.mock("@/core/sdk/server", () => ({
    prisma: { user: { findMany: (args: Record<string, unknown>) => findMany(args) } },
    isAdmin: async () => callerIsAdmin,
    logActivity: (args: unknown) => logActivity(args as never),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin1" } }) }));
vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: async (_name: string, value: unknown[]) => [...value, ...contributed],
}));

const { GET } = await import("@/modules/csv-import-export/api/export/route");
const { NextRequest } = await import("next/server");

const ask = async (query = "") =>
    GET(new NextRequest(`http://example.com/api/v1/admin/export${query}`));

const shelf = {
    id: "products",
    labelKey: "store.adm_exportProducts",
    header: ["id", "name", "price", "listed", "added"],
    read: vi.fn(async (skip: number, take: number) =>
        (skip >= 2 ? [] : [
            ["p1", "Rank: VIP", 9.5, true, new Date("2026-02-03T04:05:06Z")],
            ["p2", "=cmd|'/c calc'!A1", 0, false, null],
        ].slice(0, take)),
    ),
};

beforeEach(() => {
    vi.clearAllMocks();
    callerIsAdmin = true;
    contributed = [];
    shelf.read.mockClear();
});

describe("what the screen is offered", () => {
    it("is the members, on a site with nothing else installed", async () => {
        const body = await (await ask()).json();
        expect(body.exports).toEqual([{ id: "users", labelKey: "csvImportExport.adm_exportUsers" }]);
    });

    it("is whatever the installed modules add to it", async () => {
        contributed = [shelf];
        const body = await (await ask()).json();
        expect(body.exports.map((one: { id: string }) => one.id)).toEqual(["users", "products"]);
        expect(body.exports[1].labelKey).toBe("store.adm_exportProducts");
    });

    it("carries no way to read the rows out to the browser", async () => {
        contributed = [shelf];
        const body = await (await ask()).json();
        expect(body.exports[1].read).toBeUndefined();
        expect(body.exports[1].header).toBeUndefined();
    });

    it("is refused to a caller who is not an administrator", async () => {
        callerIsAdmin = false;
        expect((await ask()).status).toBe(403);
    });
});

describe("what a contributed export produces", () => {
    beforeEach(() => { contributed = [shelf]; });

    it("is a file under the header its own module named", async () => {
        const body = await (await ask("?type=products")).text();
        expect(body.split("\n")[0]).toBe("id,name,price,listed,added");
    });

    it("is read a page at a time, not all at once", async () => {
        await (await ask("?type=products")).text();
        expect(shelf.read).toHaveBeenCalled();
        for (const call of shelf.read.mock.calls) {
            expect(call[1], "every read is bounded").toBeTypeOf("number");
        }
    });

    it("keeps a formula out of a spreadsheet cell, whoever contributed it", async () => {
        const body = await (await ask("?type=products")).text();
        expect(body).toContain(`"'=cmd|'/c calc'!A1"`);
    });

    it("writes a date as a date and a number as a number", async () => {
        const body = await (await ask("?type=products")).text();
        const [, first] = body.trim().split("\n");
        expect(first).toContain("2026-02-03T04:05:06.000Z");
        expect(first).toContain(",9.5,true,");
    });

    it("writes an empty cell for nothing at all", async () => {
        const body = await (await ask("?type=products")).text();
        expect(body.trim().split("\n")[2].endsWith(',""')).toBe(true);
    });

    it("is named in the file the browser saves", async () => {
        const res = await ask("?type=products");
        expect(res.headers.get("Content-Disposition")).toContain("products-export-");
    });

    it("is recorded as an export of that thing", async () => {
        await (await ask("?type=products")).text();
        expect(logActivity).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "admin1", action: "data_exported" }),
        );
        expect(logActivity.mock.calls[0][0]).toMatchObject({ metadata: { type: "products" } });
    });
});

describe("a type nobody offered", () => {
    it("is refused, and nothing is read", async () => {
        const res = await ask("?type=tractors");
        expect(res.status).toBe(400);
        expect(findMany).not.toHaveBeenCalled();
        expect(logActivity).not.toHaveBeenCalled();
    });

    it("is refused even when it is a thing another install would have", async () => {
        // No shop installed here, so "products" is not something this site can
        // export - and saying so is the whole point of asking.
        const res = await ask("?type=products");
        expect(res.status).toBe(400);
    });
});
