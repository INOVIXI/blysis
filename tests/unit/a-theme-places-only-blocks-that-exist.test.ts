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
 * it; a hidden id that names nothing is a typo too. A module's page is
 * checked the same way against the blocks that page declares, and a page no
 * module declares is a typo in the arrangement's name.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blocksOf, pagesOf, type CatalogBlock, type ModulePage } from "@/core/lib/page-blocks";
import { CORE_BLOCKS } from "@/core/lib/core-blocks";
import { cellWidths, type LayoutDocument } from "@/core/lib/page-layout-schema";

const ROOT = process.cwd();

const MANIFESTS = fs.readdirSync(path.join(ROOT, "module-sources"))
    .filter((id) => fs.existsSync(path.join(ROOT, "module-sources", id, "module.json")))
    .map((id) => ({ id, manifest: JSON.parse(fs.readFileSync(path.join(ROOT, "module-sources", id, "module.json"), "utf8")) }));

const HOME = new Map([
    ...CORE_BLOCKS,
    ...MANIFESTS.flatMap(({ id, manifest }) => blocksOf(id, manifest)),
].map((b) => [b.id, b]));

const PAGES = new Map(MANIFESTS.flatMap(({ id, manifest }) => pagesOf(id, manifest)).map((p) => [p.id, p]));

interface Arrangement { theme: string; page: string; layout: LayoutDocument }

const ARRANGEMENTS: Arrangement[] = fs.readdirSync(path.join(ROOT, "src/themes"))
    .map((id) => path.join(ROOT, "src/themes", id, "theme.json"))
    .filter((file) => fs.existsSync(file))
    .flatMap((file) => Object.entries((JSON.parse(fs.readFileSync(file, "utf8")).layouts ?? {}) as Record<string, LayoutDocument>)
        .map(([page, layout]) => ({ theme: path.basename(path.dirname(file)), page, layout })));

function catalogFor(page: string, pages: Map<string, ModulePage>): Map<string, CatalogBlock> | null {
    if (page === "home") return HOME;
    const declared = pages.get(page);
    return declared ? new Map(declared.blocks.map((b) => [b.id, b])) : null;
}

function problems({ theme, page, layout }: Arrangement, pages: Map<string, ModulePage> = PAGES): string[] {
    const catalog = catalogFor(page, pages);
    if (!catalog) return [`${theme} arranges ${page}: no module declares that page`];
    const where = page === "home" ? theme : `${theme} ${page}`;
    const found: string[] = [];
    layout.rows.forEach((row, r) => row.cells.forEach((cell, c) => cell.forEach((instance) => {
        const at = `${where} row ${r} cell ${c} ${instance.block}`;
        const block = catalog.get(instance.block);
        if (!block) return void found.push(`${at}: no such block`);
        const width = cellWidths(row.split)[c];
        if (!block.widths.includes(width)) found.push(`${at}: does not fit a ${width} cell`);
        for (const key of Object.keys(instance.settings ?? {})) {
            if (!block.settings[key]) found.push(`${at}: has no setting "${key}"`);
        }
    })));
    for (const id of layout.hidden ?? []) if (!catalog.has(id)) found.push(`${where} hides ${id}: no such block`);
    return found;
}

describe("a theme's arrangement", () => {
    it("is read from at least one theme, and the catalogue it is checked against is not empty", () => {
        expect(ARRANGEMENTS.length).toBeGreaterThan(0);
        expect(HOME.size).toBeGreaterThan(CORE_BLOCKS.length);
    });

    it("names blocks that exist, in cells they fit, with settings they have", () => {
        expect(ARRANGEMENTS.flatMap((a) => problems(a))).toEqual([]);
    });

    it("would say so if one did not", () => {
        const typo: LayoutDocument = {
            rows: [{ split: "1-1-1", cells: [[{ key: "a", block: "blog.nws" }], [{ key: "b", block: "blog.news" }], [{ key: "c", block: "core.stats", settings: { tile9Value: "x" } }]] }],
            hidden: ["forum.Gone"],
        };
        expect(problems({ theme: "fixture", page: "home", layout: typo })).toEqual([
            "fixture row 0 cell 0 blog.nws: no such block",
            "fixture row 0 cell 1 blog.news: does not fit a narrow cell",
            "fixture row 0 cell 2 core.stats: does not fit a narrow cell",
            "fixture row 0 cell 2 core.stats: has no setting \"tile9Value\"",
            "fixture hides forum.Gone: no such block",
        ]);
    });

    it("would say so on a module's page, and of a page no module declares", () => {
        const pages = new Map<string, ModulePage>([["m.post", pagesOf("m", {
            pages: [{
                id: "post",
                blocks: [{ id: "article", widths: ["wide"] }, { id: "related", widths: ["narrow"] }],
                layout: { rows: [{ split: "1", cells: [[{ key: "a", block: "m.article" }]] }] },
            }],
        })[0]]]);
        const layout: LayoutDocument = {
            rows: [{ split: "1-2-1", cells: [[{ key: "a", block: "m.article" }], [{ key: "b", block: "blog.news" }], [{ key: "c", block: "m.related" }]] }],
            hidden: ["m.share"],
        };
        expect(problems({ theme: "fixture", page: "m.post", layout }, pages)).toEqual([
            "fixture m.post row 0 cell 0 m.article: does not fit a narrow cell",
            "fixture m.post row 0 cell 1 blog.news: no such block",
            "fixture m.post hides m.share: no such block",
        ]);
        expect(problems({ theme: "fixture", page: "m.gone", layout }, pages)).toEqual(["fixture arranges m.gone: no module declares that page"]);
    });
});
