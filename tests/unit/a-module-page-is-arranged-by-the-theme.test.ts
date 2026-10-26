import { describe, it, expect, vi } from "vitest";
import type { CatalogBlock, ModulePage } from "@/core/lib/page-blocks";
import type { PageArrangement } from "@/core/lib/page-layout-schema";

vi.mock("@/core/lib/logger", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { resolvePageLayout } = await import("@/core/lib/page-layout");

/**
 * A module's page is arranged the way the homepage is.
 *
 * The page declares the blocks it is built from and how it stands on a
 * theme that says nothing; a theme that wants the page another way writes
 * its own arrangement under the page's name. Whichever is drawn, a block
 * the page does not declare is not drawn, a block is drawn only where it
 * fits, a block nobody placed or hid still shows, and a theme may take the
 * visible header away, never the page's name.
 */

function block(id: string, widths: CatalogBlock["widths"], over: Partial<CatalogBlock> = {}): CatalogBlock {
    const [module, entryId] = id.split(".");
    return { id, module, entryId, component: "", widths, defaultOrder: 0, defaultVisible: true, settings: {}, replaces: [], ...over };
}

const ARTICLE = block("m.article", ["wide", "full"], {
    settings: { cover: { type: "toggle", default: true } },
});
const RELATED = block("m.related", ["narrow"]);
const SHARE = block("m.share", ["narrow"]);
const CONTENTS = block("m.contents", ["narrow"]);

const PAGE: ModulePage = {
    id: "m.post",
    module: "m",
    blocks: [ARTICLE, RELATED, SHARE, CONTENTS],
    layout: {
        rows: [{ split: "2-1", cells: [[{ key: "article", block: "m.article" }], [{ key: "related", block: "m.related" }, { key: "share", block: "m.share" }]] }],
        hidden: ["m.contents"],
    },
};

const ids = (cell: { block: CatalogBlock }[]) => cell.map((i) => i.block.id);

function resolve(themeLayout?: PageArrangement, page: ModulePage = PAGE) {
    return resolvePageLayout({ page, themeLayout });
}

describe("a module's page", () => {
    it("stands as its module arranged it under a theme that says nothing", () => {
        const layout = resolve();
        expect(layout.rows).toHaveLength(1);
        expect(layout.rows[0].split).toBe("2-1");
        expect(ids(layout.rows[0].cells[0])).toEqual(["m.article"]);
        expect(ids(layout.rows[0].cells[1])).toEqual(["m.related", "m.share"]);
        expect(layout.header).toBe("shown");
    });

    it("keeps off the page what its arrangement hid", () => {
        const drawn = resolve().rows.flatMap((r) => r.cells.flat()).map((i) => i.block.id);
        expect(drawn).not.toContain("m.contents");
    });

    it("stands as the theme arranged it when the theme has a word for it", () => {
        const layout = resolve({
            rows: [{ split: "1-2-1", cells: [[{ key: "toc", block: "m.contents" }], [{ key: "a", block: "m.article", settings: { cover: false } }], [{ key: "r", block: "m.related" }]] }],
            hidden: ["m.share"],
        });
        expect(layout.rows).toHaveLength(1);
        expect(layout.rows[0].cells.map(ids)).toEqual([["m.contents"], ["m.article"], ["m.related"]]);
        expect(layout.rows[0].cells[1][0].settings).toEqual({ cover: false });
        expect(layout.rows[0].cells[1][0].width).toBe("wide");
    });

    it("draws no block the page does not declare", () => {
        const layout = resolve({ rows: [{ split: "1", cells: [[{ key: "x", block: "m.nope" }, { key: "a", block: "m.article" }]] }], hidden: ["m.related", "m.share", "m.contents"] });
        expect(layout.rows.flatMap((r) => r.cells.flat()).map((i) => i.block.id)).toEqual(["m.article"]);
    });

    it("draws a block only in a cell it fits", () => {
        const layout = resolve({ rows: [{ split: "1", cells: [[{ key: "r", block: "m.related" }, { key: "a", block: "m.article" }]] }], hidden: ["m.share", "m.contents"] });
        // The related list is narrow only; placed in a wide cell, it is not
        // drawn there, and since the theme named it, it is not added back.
        expect(layout.rows.flatMap((r) => r.cells.flat()).map((i) => i.block.id)).toEqual(["m.article"]);
    });

    it("still shows a block nobody placed or hid, in the rest cell", () => {
        const layout = resolve({
            rows: [{ split: "2-1", cells: [[{ key: "a", block: "m.article" }], [{ key: "r", block: "m.related" }]], rest: 1 }],
        });
        expect(layout.rows).toHaveLength(1);
        expect(ids(layout.rows[0].cells[1])).toEqual(["m.related", "m.contents", "m.share"]);
    });

    it("gives a block nobody placed a row of its own when nothing takes the rest", () => {
        const layout = resolve({ rows: [{ split: "1", cells: [[{ key: "a", block: "m.article" }]] }], hidden: ["m.contents"] });
        expect(layout.rows).toHaveLength(2);
        expect(layout.rows[1].split).toBe("2-1");
        expect(ids(layout.rows[1].cells[1])).toEqual(["m.related", "m.share"]);
    });

    it("hands a block its settings checked, with every default filled", () => {
        const layout = resolve({ rows: [{ split: "1", cells: [[{ key: "a", block: "m.article", settings: { cover: "yes" } }]] }], hidden: ["m.related", "m.share", "m.contents"] });
        expect(layout.rows[0].cells[0][0].settings).toEqual({ cover: true });
    });

    it("lets a theme take the visible header away", () => {
        expect(resolve({ header: "hidden", rows: [{ split: "1", cells: [[{ key: "a", block: "m.article" }]] }] }).header).toBe("hidden");
    });

    it("carries the words a theme gives the page's heading, and none when it gives none", () => {
        const heading = { kicker: "kite.storeKicker", title: "Pazar yeri", description: "kite.storeLede" };
        expect(resolve({ heading, rows: [{ split: "1", cells: [[{ key: "a", block: "m.article" }]] }] }).heading).toEqual(heading);
        expect(resolve().heading).toBeUndefined();
    });

    it("keeps the module's own arrangement when a theme only words the heading", () => {
        const layout = resolve({ heading: { title: "Pazar yeri" } });
        expect(layout.heading).toEqual({ title: "Pazar yeri" });
        expect(layout.rows.map((row) => row.cells.map(ids))).toEqual(resolve().rows.map((row) => row.cells.map(ids)));
        expect(layout.rows.flatMap((row) => row.cells.flat()).map((i) => i.block.id)).not.toContain("m.contents");
    });
});
