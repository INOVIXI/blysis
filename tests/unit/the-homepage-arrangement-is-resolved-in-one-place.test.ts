import { describe, it, expect, vi } from "vitest";
import type { CatalogBlock } from "@/core/lib/page-blocks";
import type { LayoutDocument } from "@/core/lib/page-layout-schema";

vi.mock("@/core/lib/logger", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { resolveLayout } = await import("@/core/lib/page-layout");

/**
 * What the homepage draws is decided in one function.
 *
 * The arrangement is the theme's, or, for a theme that ships none, from the widget order and visibility the
 * old Settings > Widgets screen saved, so an upgraded site looks exactly as
 * it did. Whatever the source, a block of a module that is gone or switched
 * off is left out, a block is only drawn where it fits, a bad setting falls
 * back to its default, and a block the arrangement never named still shows.
 */

function block(id: string, over: Partial<CatalogBlock> = {}): CatalogBlock {
    const [module, entryId] = id.split(".");
    return {
        id, module, entryId, component: `widgets/${entryId}`, widths: ["narrow"],
        defaultOrder: 0, defaultVisible: true, settings: {}, replaces: [entryId], ...over,
    };
}

const section = (id: string, order: number) => block(id, { widths: ["wide", "full"], defaultOrder: order });

const ids = (cell: { block: CatalogBlock }[]) => cell.map((i) => i.block.id);

function resolve(input: Partial<Parameters<typeof resolveLayout>[0]> & { blocks: CatalogBlock[] }) {
    return resolveLayout({ themeLayout: undefined, enabled: () => true, settings: {}, ...input });
}

describe("the homepage's arrangement", () => {
    it("draws today's page under a theme that ships no arrangement", () => {
        const layout = resolve({
            blocks: [section("m.x", 10), section("m.y", 20), block("m.a"), block("m.b"), block("m.c")],
            settings: { widget_order: ["c", "a"], widget_visibility: { b: false } },
        });
        expect(layout.rows).toHaveLength(1);
        expect(layout.rows[0].split).toBe("2-1");
        expect(ids(layout.rows[0].cells[0])).toEqual(["m.x", "m.y"]);
        expect(ids(layout.rows[0].cells[1])).toEqual(["m.c", "m.a"]);
        expect(layout.welcome).toBe(false);
    });

    it("skips a saved id nobody registers", () => {
        const layout = resolve({ blocks: [block("m.a"), block("m.b")], settings: { widget_order: ["gone", "b", "a"] } });
        expect(ids(layout.rows[0].cells[1])).toEqual(["m.b", "m.a"]);
    });

    it("follows a widget to its new name", () => {
        const layout = resolve({
            blocks: [block("m.a"), block("m.renamed", { replaces: ["OldId"] })],
            settings: { widget_order: ["OldId", "a"] },
        });
        expect(ids(layout.rows[0].cells[1])).toEqual(["m.renamed", "m.a"]);
    });

    it("prefers the theme's arrangement over core's", () => {
        const blocks = [block("m.a"), block("m.b")];
        const theme: LayoutDocument = { rows: [{ split: "1-1", cells: [[{ key: "b", block: "m.b" }], [{ key: "a", block: "m.a" }]] }] };
        expect(resolve({ blocks }).rows[0].split).toBe("2-1");
        expect(resolve({ blocks, themeLayout: theme }).rows[0].split).toBe("1-1");
    });

    describe("under a theme's arrangement, Settings > Widgets still", () => {
        const placed: LayoutDocument = { rows: [{ split: "2-1", cells: [[], [{ key: "a", block: "m.a" }]], rest: 1 }] };

        it("hides a widget it switched off, wherever the theme put it", () => {
            const layout = resolve({ blocks: [block("m.a")], themeLayout: placed, settings: { widget_visibility: { a: false } } });
            expect(ids(layout.rows[0].cells[1])).toEqual([]);
        });

        it("leaves a theme's widget standing when nothing was switched", () => {
            const layout = resolve({ blocks: [block("m.a", { defaultVisible: false })], themeLayout: placed });
            expect(ids(layout.rows[0].cells[1])).toEqual(["m.a"]);
        });

        it("orders the widgets the theme leaves to the page", () => {
            const open: LayoutDocument = { rows: [{ split: "2-1", cells: [[], []], rest: 1 }] };
            const layout = resolve({ blocks: [block("m.a"), block("m.b"), block("m.c")], themeLayout: open, settings: { widget_order: ["c", "a"] } });
            expect(ids(layout.rows[0].cells[1])).toEqual(["m.c", "m.a", "m.b"]);
        });

        it("adds a widget it switched on that is off by default", () => {
            const open: LayoutDocument = { rows: [{ split: "2-1", cells: [[], []], rest: 1 }] };
            const layout = resolve({ blocks: [block("m.a", { defaultVisible: false })], themeLayout: open, settings: { widget_visibility: { a: true } } });
            expect(ids(layout.rows[0].cells[1])).toEqual(["m.a"]);
        });
    });

    it("drops a disabled module's block", () => {
        const layout = resolve({ blocks: [block("on.a"), block("off.b")], enabled: (m) => m !== "off" });
        expect(ids(layout.rows[0].cells[1])).toEqual(["on.a"]);
    });

    it("drops a block placed in a cell too narrow for it", () => {
        const theme: LayoutDocument = { rows: [{ split: "1-1", cells: [[{ key: "x", block: "m.x" }], [{ key: "a", block: "m.a" }]] }] };
        const layout = resolve({ blocks: [section("m.x", 0), block("m.a")], themeLayout: theme });
        expect(ids(layout.rows[0].cells[0])).toEqual([]);
        expect(ids(layout.rows[0].cells[1])).toEqual(["m.a"]);
    });

    it("appends a block the document never named to the rest cell, and not one it hid", () => {
        const theme: LayoutDocument = {
            rows: [{ split: "2-1", cells: [[], [{ key: "a", block: "m.a" }]], rest: 1 }],
            hidden: ["m.c"],
        };
        const layout = resolve({ blocks: [block("m.a"), block("m.b", { defaultOrder: 5 }), block("m.c")], themeLayout: theme });
        expect(ids(layout.rows[0].cells[1])).toEqual(["m.a", "m.b"]);
    });

    it("gives a block it adds a key no placement on the page has", () => {
        const theme: LayoutDocument = {
            rows: [{ split: "2-1", cells: [[], [{ key: "m-b", block: "m.a" }]], rest: 1 }],
        };
        const layout = resolve({ blocks: [block("m.a"), block("m.b")], themeLayout: theme });
        const keys = layout.rows.flatMap((row) => row.cells.flat().map((i) => i.key));
        expect(ids(layout.rows[0].cells[1])).toEqual(["m.a", "m.b"]);
        expect(new Set(keys).size).toBe(keys.length);

        const noRest: LayoutDocument = { rows: [{ split: "1", cells: [[{ key: "m-a", block: "m.x" }]] }] };
        const own = resolve({ blocks: [section("m.x", 0), block("m.a")], themeLayout: noRest });
        const ownKeys = own.rows.flatMap((row) => row.cells.flat().map((i) => i.key));
        expect(ownKeys).toHaveLength(2);
        expect(new Set(ownKeys).size).toBe(2);
    });

    it("stands a block that needs the whole width above today's page", () => {
        const banner = block("m.banner", { widths: ["full"] });
        const layout = resolve({ blocks: [section("m.x", 0), block("m.a"), banner] });
        expect(layout.rows.map((row) => row.split)).toEqual(["full", "2-1"]);
        expect(ids(layout.rows[0].cells[0])).toEqual(["m.banner"]);
    });

    it("gives an unnamed block a row of its own when the document has no rest cell", () => {
        const theme: LayoutDocument = { rows: [{ split: "1", cells: [[{ key: "x", block: "m.x" }]] }] };
        const layout = resolve({ blocks: [section("m.x", 0), block("m.a")], themeLayout: theme });
        expect(layout.rows).toHaveLength(2);
        expect(ids(layout.rows[1].cells[1])).toEqual(["m.a"]);
    });

    it("falls back to a setting's default when the theme gives one it cannot hold", () => {
        const counted = block("m.a", { settings: { count: { type: "number", default: 4, min: 1, max: 12 } } });
        const theme: LayoutDocument = { rows: [{ split: "1-1", cells: [[{ key: "a", block: "m.a", settings: { count: "many" } }], []] }] };
        expect(resolve({ blocks: [counted], themeLayout: theme }).rows[0].cells[0][0].settings).toEqual({ count: 4 });
    });

    it("draws the welcome card when nothing has content", () => {
        expect(resolve({ blocks: [block("m.a")] }).welcome).toBe(true);
        expect(resolve({ blocks: [] }).welcome).toBe(true);
    });

    it("says which width each block was placed in", () => {
        const layout = resolve({ blocks: [section("m.x", 0), block("m.a")] });
        expect(layout.rows[0].cells[0][0].width).toBe("wide");
        expect(layout.rows[0].cells[1][0].width).toBe("narrow");
    });
});
