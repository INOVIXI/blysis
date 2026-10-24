import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

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

    it("keeps the sidebar collapse rules the layout depends on", () => {
        // SidebarLayout renders these two attributes and nothing else styles
        // them; losing the rules puts the empty-column bug straight back.
        expect(CSS).toMatch(/\[data-sidebar-layout\][^{]*\[data-sidebar-main\]/);
        // A column holding only the heading spacer and blocks that drew
        // nothing is empty too.
        expect(CSS).toContain("[data-sidebar]:not(:has(> :not(template, .blysis-heading-spacer, [data-block]:empty)))");
    });
});
