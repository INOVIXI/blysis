import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { stripComments } from "./source-text";

const CSS = fs.readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf-8");

/**
 * Every `:has()` in the file, paired with how many `:has()` arguments it is
 * already inside.
 */
function hasNestingDepths(css: string): number[] {
    const depths: number[] = [];
    // Parenthesis depths at which an open `:has(` is currently waiting.
    const openHas: number[] = [];
    let depth = 0;
    for (let i = 0; i < css.length; i++) {
        if (css.startsWith(":has(", i)) {
            depths.push(openHas.length);
            openHas.push(depth);
            depth++;
            i += 4;
            continue;
        }
        if (css[i] === "(") depth++;
        else if (css[i] === ")") {
            depth--;
            if (openHas.length > 0 && openHas[openHas.length - 1] === depth) openHas.pop();
        }
    }
    return depths;
}

describe("globals.css", () => {
    it("never nests :has() inside another :has()", () => {
        // CSS forbids it, and a browser drops the whole rule without warning.
        // The sidebar collapse shipped this way once: the column hid, the
        // content kept two thirds of the row, and the page still looked off
        // centre with nothing in the console to say why.
        expect(hasNestingDepths(CSS).filter((d) => d > 0)).toEqual([]);
    });

    it("detects the nesting it is meant to catch", () => {
        expect(hasNestingDepths("a:has(> b:not(:has(> c))) { color: red }")).toEqual([0, 1]);
        expect(hasNestingDepths("a:has(> b) c:has(> d) { color: red }")).toEqual([0, 0]);
    });

    it("places the main column with rules any theme rule outranks", () => {
        // A theme's stylesheet is scoped under `[data-theme="..."]`, so its
        // rule on the main column is at least two attributes and a class
        // strong. Core's "two thirds when there is a sidebar" rule grew past
        // that when its `:has()` learned to ignore empty blocks, and a theme
        // that lays the homepage out as its own grid had its main column
        // pushed into a second, zero-width track. Inside `:where()` core's
        // condition weighs nothing, whatever it has to say.
        const rules = [...stripComments(CSS).matchAll(/([^{}]+)\{[^{}]*grid-column[^{}]*\}/g)]
            .map((m) => m[1].trim())
            .filter((selector) => selector.endsWith("> [data-sidebar-main]"));
        expect(rules.length).toBeGreaterThanOrEqual(2);
        for (const selector of rules) expect(selector).toMatch(/^:where\(/);
    });

    it("is asked the same way by a theme that asks whether a sidebar has anything in it", () => {
        // A theme that lays the homepage out itself asks the same question
        // core does, and asked it the old way: a sidebar of blocks that all
        // drew nothing still got its column there.
        const themes = path.resolve(__dirname, "../../src/themes");
        const asks = fs.readdirSync(themes)
            .map((id) => path.join(themes, id, "theme.css"))
            .filter((file) => fs.existsSync(file))
            .flatMap((file) => [...fs.readFileSync(file, "utf-8").matchAll(/\[data-sidebar\] > :not\(([^)]*)\)/g)]
                .map((m) => `${path.basename(path.dirname(file))}: ${m[1]}`));
        expect(asks.length).toBeGreaterThan(0);
        for (const ask of asks) expect(ask).toMatch(/template, \.blysis-heading-spacer, \[data-block\]:empty$/);
    });

    it("keeps the sidebar collapse rules the layout depends on", () => {
        // SidebarLayout renders these two attributes and nothing else styles
        // them; losing the rules puts the empty-column bug straight back.
        expect(CSS).toMatch(/\[data-sidebar-layout\][^{]*\[data-sidebar-main\]/);
        // A column holding only the heading spacer and blocks that drew
        // nothing is empty too.
        expect(CSS).toContain("[data-sidebar]:not(:has(> :not(template, .blysis-heading-spacer, [data-block]:empty)))");
    });
});
