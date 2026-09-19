// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A shelf keeps what it was set up with.
 *
 * `layout` decides whether a category draws its products as cards to browse
 * or as a ladder to compare, which is the difference between a shop's
 * cosmetics shelf and its ranks. The form offers the choice, the schema
 * accepts it, the edit route stores it - and the create route did not. It
 * lists the columns it writes one by one and `layout` was never added to the
 * list, so every category made through the panel was a grid whatever the
 * operator picked, and the only way to get a table was to make the category
 * and then edit it.
 *
 * A category could not be switched off either. The value is loaded into the
 * form, sent back with it and shown as a badge on the list, and no control on
 * the page could change it - so a shelf, once live, was live until it was
 * deleted.
 */

const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "c1", ...args.data }));
const findFirst = vi.fn(async () => null);
const count = vi.fn(async () => 0);

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        category: { create: (args: never) => create(args), findFirst: () => findFirst(), findUnique: () => findFirst() },
        product: { count: () => count() },
    },
    hasPermission: async () => true,
    log: { error: () => {}, info: () => {} },
    readJsonBody: async (request: { json: () => Promise<unknown> }) => request.json(),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin", role: "ADMIN" } }) }));
vi.mock("@/core/sdk", () => ({ slugify: (s: string) => s.toLowerCase().replace(/\s+/g, "-") }));
vi.mock("@/modules/store/lib/category-visibility", () => ({
    anyCategoryGated: () => false,
    gateProductIds: () => [],
    visibleCategories: (rows: unknown) => rows,
}));
vi.mock("@/modules/store/lib/ownership", () => ({ stillOwnedWhere: () => ({}) }));

const { POST } = await import("@/modules/store/api/categories/route");

function ask(body: Record<string, unknown>) {
    return new Request("http://localhost/api/v1/store/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
    create.mockClear();
});

describe("a new shelf", () => {
    it("is drawn the way it was asked to be drawn", async () => {
        const res = await POST(ask({ name: "Ranks", layout: "table" }));
        expect(res.status).toBe(201);
        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0][0].data.layout).toBe("table");
    });

    it("is on or off as the form said, not on whatever it was asked", async () => {
        await POST(ask({ name: "Hidden", isActive: false }));
        expect(create.mock.calls[0][0].data.isActive).toBe(false);
    });
});

describe("the shelf form", () => {
    const ROOT = path.resolve(__dirname, "../../..");
    const screen = fs.readFileSync(path.join(ROOT, "module-sources/store/pages/admin/categories/page.tsx"), "utf8");

    it("can switch a shelf off, which is the only thing short of deleting it", () => {
        expect(screen).toContain("adm_categoryActive");
        expect(screen).toMatch(/isActive:\s*e\.target\.checked/);
    });

    it("calls the picture a picture, since it takes a link, a file or the library", () => {
        expect(screen).not.toContain("adm_imageUrl");
    });
});

describe("the list of products a shelf can be gated behind", () => {
    const ROOT = path.resolve(__dirname, "../../..");
    const picker = fs.readFileSync(
        path.join(ROOT, "module-sources/store/pages/admin/products/_fields/RequirementFields.tsx"),
        "utf8",
    );

    it("can be searched, because a shop has more products than a box holds", () => {
        // Two hundred names in a scrolling box, on three screens: both product
        // forms and the category one.
        expect(picker).toContain("ListControls");
    });
});
