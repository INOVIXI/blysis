/**
 * The homepage's arrangement is the theme's, and a database that cannot
 * answer does not take the homepage with it.
 *
 * The only part of it read from the database is what Settings > Widgets
 * saved. When that read fails, the widgets count as unsaved and the theme's
 * arrangement is drawn, the same way a module's state falls back when its
 * table cannot be read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ fail: false, settings: {} as Record<string, unknown> }));

vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("@/core/lib/module-cache", () => ({ getModuleStates: async () => ({}) }));
vi.mock("@/core/lib/setting-values", () => ({
    readSettingValues: async () => {
        if (state.fail) throw new Error("connection refused");
        return state.settings;
    },
}));
vi.mock("@/core/generated/module-registry", () => ({
    ModuleBlocks: [{ id: "m.a", module: "m", entryId: "a", component: "w/a", widths: ["narrow"], defaultOrder: 0, defaultVisible: true, settings: {}, replaces: ["a"] }],
}));
vi.mock("@/core/generated/theme-registry", () => ({
    themeRegistry: { sample: { layouts: { home: { rows: [{ split: "1-1", cells: [[{ key: "a", block: "m.a" }], []] }] } } } },
}));

const { loadHomeLayout } = await import("@/core/lib/page-layout-loader");

beforeEach(() => {
    state.fail = false;
    state.settings = {};
});

describe("the homepage's arrangement", () => {
    it("is the theme's", async () => {
        const layout = await loadHomeLayout("sample");
        expect(layout.rows[0].split).toBe("1-1");
        expect(layout.rows[0].cells[0].map((i) => i.block.id)).toEqual(["m.a"]);
    });

    it("is core's under a theme that ships none", async () => {
        expect((await loadHomeLayout("plain")).rows[0].split).toBe("2-1");
    });

    it("is still drawn when the widget settings cannot be read", async () => {
        state.fail = true;
        expect((await loadHomeLayout("sample")).rows[0].cells[0].map((i) => i.block.id)).toEqual(["m.a"]);
    });
});
