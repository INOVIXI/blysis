import { describe, it, expect, vi } from "vitest";
import type { CatalogBlock } from "@/core/lib/page-blocks";
import type { LayoutDocument } from "@/core/lib/page-layout-schema";

vi.mock("@/core/lib/logger", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { resolveLayout } = await import("@/core/lib/page-layout");

/**
 * What the homepage draws is decided in one function.
 *
 * The arrangement comes from the operator's saved document, or the theme's,
 * or, for a site that has neither, from the widget order and visibility the
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
    return resolveLayout({ saved: null, themeDefault: undefined, enabled: () => true, settings: {}, ...input });
}

describe("the homepage's arrangement", () => {
    it("draws today's page for a site that never saved one", () => {
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

    it("prefers the saved document over the theme's, and the theme's over core's", () => {
        const blocks = [block("m.a"), block("m.b")];
        const theme: LayoutDocument = { rows: [{ split: "1-1", cells: [[{ key: "b", block: "m.b" }], [{ key: "a", block: "m.a" }]] }] };
        const saved: LayoutDocument = { rows: [{ split: "1-1-1", cells: [[{ key: "a", block: "m.a" }], [], [{ key: "b", block: "m.b" }]] }] };
        expect(resolve({ blocks, themeDefault: theme }).rows[0].split).toBe("1-1");
        expect(resolve({ blocks, themeDefault: theme, saved }).rows[0].split).toBe("1-1-1");
    });

    it("drops a disabled module's block", () => {
        const layout = resolve({ blocks: [block("on.a"), block("off.b")], enabled: (m) => m !== "off" });
        expect(ids(layout.rows[0].cells[1])).toEqual(["on.a"]);
    });

    it("drops a block placed in a cell too narrow for it", () => {
        const saved: LayoutDocument = { rows: [{ split: "1-1", cells: [[{ key: "x", block: "m.x" }], [{ key: "a", block: "m.a" }]] }] };
        const layout = resolve({ blocks: [section("m.x", 0), block("m.a")], saved });
        expect(ids(layout.rows[0].cells[0])).toEqual([]);
        expect(ids(layout.rows[0].cells[1])).toEqual(["m.a"]);
    });

    it("appends a block the document never named to the rest cell, and not one it hid", () => {
        const saved: LayoutDocument = {
            rows: [{ split: "2-1", cells: [[], [{ key: "a", block: "m.a" }]], rest: 1 }],
            hidden: ["m.c"],
        };
        const layout = resolve({ blocks: [block("m.a"), block("m.b", { defaultOrder: 5 }), block("m.c")], saved });
        expect(ids(layout.rows[0].cells[1])).toEqual(["m.a", "m.b"]);
    });

    it("gives an unnamed block a row of its own when the document has no rest cell", () => {
        const saved: LayoutDocument = { rows: [{ split: "1", cells: [[{ key: "x", block: "m.x" }]] }] };
        const layout = resolve({ blocks: [section("m.x", 0), block("m.a")], saved });
        expect(layout.rows).toHaveLength(2);
        expect(ids(layout.rows[1].cells[1])).toEqual(["m.a"]);
    });

    it("keeps a page when one instance is malformed", () => {
        const counted = block("m.a", { settings: { count: { type: "number", default: 4, min: 1, max: 12 } } });
        const saved = { rows: [{ split: "1-1", cells: [[{ key: "a", block: "m.a", settings: { count: "many" } }], []] }] };
        expect(resolve({ blocks: [counted], saved }).rows[0].cells[0][0].settings).toEqual({ count: 4 });

        const theme: LayoutDocument = { rows: [{ split: "1-1", cells: [[{ key: "a", block: "m.a" }], []] }] };
        const broken = { rows: [{ split: "3-1", cells: [] }] };
        expect(resolve({ blocks: [counted], saved: broken, themeDefault: theme }).rows[0].split).toBe("1-1");
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
