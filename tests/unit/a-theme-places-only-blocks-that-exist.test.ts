// @vitest-environment node
/**
 * A theme's arrangement places only blocks that exist, where they fit, with
 * settings they have.
 *
 * The homepage draws what it can and leaves the rest out without a word, as
 * it must on a site where a module is missing. That same quiet made a typo
 * in a theme's arrangement invisible: a block id spelt wrong, a block placed
 * in a cell narrower than it allows or a setting it does not have was simply
 * not drawn, on every site, and nothing said why. Every block a first-party
 * module or core offers is known here, so each placement is checked against
 * it; a hidden id that names nothing is a typo too.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blocksOf } from "@/core/lib/page-blocks";
import { CORE_BLOCKS } from "@/core/lib/core-blocks";
import { cellWidths, type LayoutDocument } from "@/core/lib/page-layout-schema";

const ROOT = process.cwd();

const CATALOG = new Map([
    ...CORE_BLOCKS,
    ...fs.readdirSync(path.join(ROOT, "module-sources"))
        .filter((id) => fs.existsSync(path.join(ROOT, "module-sources", id, "module.json")))
        .flatMap((id) => blocksOf(id, JSON.parse(fs.readFileSync(path.join(ROOT, "module-sources", id, "module.json"), "utf8")))),
].map((b) => [b.id, b]));

const ARRANGEMENTS = fs.readdirSync(path.join(ROOT, "src/themes"))
    .map((id) => path.join(ROOT, "src/themes", id, "theme.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ theme: path.basename(path.dirname(file)), home: JSON.parse(fs.readFileSync(file, "utf8")).layouts?.home as LayoutDocument | undefined }))
    .filter((t): t is { theme: string; home: LayoutDocument } => Boolean(t.home));

function problems({ theme, home }: { theme: string; home: LayoutDocument }): string[] {
    const found: string[] = [];
    home.rows.forEach((row, r) => row.cells.forEach((cell, c) => cell.forEach((instance) => {
        const at = `${theme} row ${r} cell ${c} ${instance.block}`;
        const block = CATALOG.get(instance.block);
        if (!block) return void found.push(`${at}: no such block`);
        const width = cellWidths(row.split)[c];
        if (!block.widths.includes(width)) found.push(`${at}: does not fit a ${width} cell`);
        for (const key of Object.keys(instance.settings ?? {})) {
            if (!block.settings[key]) found.push(`${at}: has no setting "${key}"`);
        }
    })));
    for (const id of home.hidden ?? []) if (!CATALOG.has(id)) found.push(`${theme} hides ${id}: no such block`);
    return found;
}

describe("a theme's arrangement", () => {
    it("is read from at least one theme, and the catalogue it is checked against is not empty", () => {
        expect(ARRANGEMENTS.length).toBeGreaterThan(0);
        expect(CATALOG.size).toBeGreaterThan(CORE_BLOCKS.length);
    });

    it("names blocks that exist, in cells they fit, with settings they have", () => {
        expect(ARRANGEMENTS.flatMap(problems)).toEqual([]);
    });

    it("would say so if one did not", () => {
        const typo: LayoutDocument = {
            rows: [{ split: "1-1-1", cells: [[{ key: "a", block: "blog.nws" }], [{ key: "b", block: "blog.news" }], [{ key: "c", block: "core.stats", settings: { tile9Value: "x" } }]] }],
            hidden: ["forum.Gone"],
        };
        expect(problems({ theme: "fixture", home: typo })).toEqual([
            "fixture row 0 cell 0 blog.nws: no such block",
            "fixture row 0 cell 1 blog.news: does not fit a narrow cell",
            "fixture row 0 cell 2 core.stats: does not fit a narrow cell",
            "fixture row 0 cell 2 core.stats: has no setting \"tile9Value\"",
            "fixture hides forum.Gone: no such block",
        ]);
    });
});
