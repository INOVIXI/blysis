import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { cellWidths, layoutDocumentSchema } from "@/core/lib/page-layout-schema";
import { themeManifestSchema } from "@/core/lib/theme-manifest-schema";

/**
 * A page's arrangement is a document with one shape and fixed limits.
 *
 * It comes from three places core does not write: a theme's manifest, a
 * ZIP somebody uploaded and the panel an operator edits. So the shape is
 * checked wherever it arrives, a row has exactly the cells its split says,
 * the place new blocks go is one cell of one row, and every count has a
 * ceiling, so a document cannot be made that the page cannot draw.
 */

const instance = (key: string, block = "sample.news") => ({ key, block });

const ONE_ROW = {
    rows: [{ split: "2-1", cells: [[instance("a")], [instance("b", "sample.side")]], rest: 1 }],
};

function parse(doc: unknown) {
    return layoutDocumentSchema.safeParse(doc);
}

describe("a layout document", () => {
    it("is rows of cells of blocks", () => {
        expect(parse(ONE_ROW).success).toBe(true);
    });

    it("has as many cells as its split says", () => {
        expect(parse({ rows: [{ split: "2-1", cells: [[instance("a")]] }] }).success).toBe(false);
    });

    it("sends new blocks to a cell that exists", () => {
        expect(parse({ rows: [{ ...ONE_ROW.rows[0], rest: 2 }] }).success).toBe(false);
    });

    it("sends new blocks to one place only", () => {
        expect(parse({ rows: [ONE_ROW.rows[0], { split: "1", cells: [[instance("c")]], rest: 0 }] }).success).toBe(false);
    });

    it("has at most thirty rows", () => {
        const rows = Array.from({ length: 31 }, (_, i) => ({ split: "1", cells: [[instance(`r${i}`)]] }));
        expect(parse({ rows }).success).toBe(false);
    });

    it("has at most twelve blocks in a cell", () => {
        const cell = Array.from({ length: 13 }, (_, i) => instance(`c${i}`));
        expect(parse({ rows: [{ split: "1", cells: [cell] }] }).success).toBe(false);
    });

    it("names each placed block once", () => {
        expect(parse({ rows: [{ split: "1-1", cells: [[instance("a")], [instance("a")]] }] }).success).toBe(false);
    });

    it("names a block as module and entry", () => {
        expect(parse({ rows: [{ split: "1", cells: [[instance("a", "news")]] }] }).success).toBe(false);
    });

    it("knows what width each split offers", () => {
        expect(cellWidths("1-2")).toEqual(["narrow", "wide"]);
        expect(cellWidths("full")).toEqual(["full"]);
        expect(cellWidths("1-1-1-1")).toEqual(["narrow", "narrow", "narrow", "narrow"]);
    });
});

describe("a theme", () => {
    const flat = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/themes/flat/theme.json"), "utf8"));

    it("may ship the arrangement of its homepage", () => {
        expect(themeManifestSchema.safeParse({ ...flat, layouts: { home: ONE_ROW } }).success).toBe(true);
    });

    it("may not ship one the page cannot draw", () => {
        expect(themeManifestSchema.safeParse({ ...flat, layouts: { home: { rows: [{ split: "3-1", cells: [[], []] }] } } }).success).toBe(false);
    });
});
