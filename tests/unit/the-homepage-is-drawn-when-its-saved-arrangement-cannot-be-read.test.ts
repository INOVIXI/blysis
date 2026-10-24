/**
 * The homepage's arrangement is read from the database, and a database that
 * cannot answer does not take the homepage with it.
 *
 * The saved arrangement is one row in `PageLayout`. When the query fails,
 * the theme's own arrangement is drawn instead of an error page, the same
 * way a module's state falls back when its table cannot be read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ row: null as unknown, fail: false, asked: [] as unknown[] }));

vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("@/core/lib/db", () => ({
    prisma: {
        pageLayout: {
            findUnique: (args: unknown) => {
                state.asked.push(args);
                return state.fail ? Promise.reject(new Error("connection refused")) : Promise.resolve(state.row);
            },
        },
    },
}));
vi.mock("@/core/lib/module-cache", () => ({ getModuleStates: async () => ({}) }));
vi.mock("@/core/lib/setting-values", () => ({ readSettingValues: async () => ({}) }));
vi.mock("@/core/generated/module-registry", () => ({
    ModuleBlocks: [{ id: "m.a", module: "m", entryId: "a", component: "w/a", widths: ["narrow"], defaultOrder: 0, defaultVisible: true, settings: {}, replaces: ["a"] }],
}));
vi.mock("@/core/generated/theme-registry", () => ({
    themeRegistry: { sample: { layouts: { home: { rows: [{ split: "1-1", cells: [[{ key: "a", block: "m.a" }], []] }] } } } },
}));

const { loadHomeLayout } = await import("@/core/lib/page-layout-loader");

beforeEach(() => {
    state.row = null;
    state.fail = false;
    state.asked = [];
});

describe("the homepage's arrangement", () => {
    it("is the one saved for this page and theme", async () => {
        state.row = { document: { rows: [{ split: "1-1-1", cells: [[{ key: "a", block: "m.a" }], [], []] }] } };
        const layout = await loadHomeLayout("sample");
        expect(layout.rows[0].split).toBe("1-1-1");
        expect(state.asked[0]).toMatchObject({ where: { page_themeId: { page: "home", themeId: "sample" } } });
    });

    it("is the theme's when nothing is saved", async () => {
        expect((await loadHomeLayout("sample")).rows[0].split).toBe("1-1");
    });

    it("is the theme's when the database cannot be read", async () => {
        state.fail = true;
        expect((await loadHomeLayout("sample")).rows[0].split).toBe("1-1");
    });
});
