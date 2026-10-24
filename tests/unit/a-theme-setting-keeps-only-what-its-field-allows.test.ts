/**
 * Saving a theme's settings keeps only what each field may hold.
 *
 * The settings route checked values with a copy of its own: an address
 * starting with "/" passed, so "//evil.example", a link to somebody else's
 * host, was stored, and a number was stored whatever the field's bounds. A
 * value the field cannot hold is dropped, which removes any earlier value,
 * rather than stored.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const calls = vi.hoisted(() => ({ upserts: [] as { key: string; value: unknown }[], deletes: [] as string[] }));

vi.mock("@/core/lib/auth", () => ({ auth: async () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/core/lib/permissions", () => ({ isAdmin: async () => true }));
vi.mock("@/core/generated/theme-registry", () => ({
    themeRegistry: {
        sample: { settings: { hero: { label: "Hero", fields: { ctaHref: { type: "url" }, count: { type: "number", min: 1, max: 12 } } } } },
    },
}));
vi.mock("@/core/lib/db", () => ({
    prisma: {
        themeSetting: {
            upsert: (args: { create: { key: string; value: unknown } }) => {
                calls.upserts.push({ key: args.create.key, value: args.create.value });
                return Promise.resolve();
            },
            deleteMany: (args: { where: { key: string } }) => {
                calls.deletes.push(args.where.key);
                return Promise.resolve();
            },
        },
        $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    },
}));

const { PUT } = await import("@/app/api/v1/themes/[id]/settings/[group]/route");

function save(values: Record<string, unknown>) {
    const req = new NextRequest("http://localhost/api/v1/themes/sample/settings/hero", {
        method: "PUT",
        body: JSON.stringify({ values }),
        headers: { "content-type": "application/json" },
    });
    return PUT(req, { params: Promise.resolve({ id: "sample", group: "hero" }) });
}

beforeEach(() => {
    calls.upserts = [];
    calls.deletes = [];
});

describe("saving a theme's settings", () => {
    it("keeps an address on this site and a number in bounds", async () => {
        expect((await save({ ctaHref: "/store", count: 4 })).status).toBe(200);
        expect(calls.upserts).toEqual([{ key: "ctaHref", value: "/store" }, { key: "count", value: 4 }]);
    });

    it("drops an address on another host", async () => {
        await save({ ctaHref: "//evil.example" });
        expect(calls.upserts).toEqual([]);
        expect(calls.deletes).toEqual(["ctaHref"]);
    });

    it("drops a number outside the field's bounds", async () => {
        await save({ count: 400 });
        expect(calls.upserts).toEqual([]);
        expect(calls.deletes).toEqual(["count"]);
    });
});
