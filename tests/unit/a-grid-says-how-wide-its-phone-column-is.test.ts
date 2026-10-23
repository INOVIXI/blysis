import { describe, it, expect } from "vitest";
import { grepTree, stripComments } from "./source-text";

/**
 * A grid that turns into columns at a breakpoint states its one column below it.
 *
 * `grid lg:grid-cols-3` has no column template on a phone, so its single
 * column is an implicit `auto` track. An auto track grows to the widest
 * min-content of anything in it, and a scroll container does not stop that:
 * the homepage's leaderboard widget has a tab rail that scrolls on its own,
 * and it still pushed the column, every card in it and the document to about
 * 600px on a 320px phone. `a-page-fits-the-phone-it-is-read-on.spec.ts`
 * measured it on the homepage; every other grid written the same way was the
 * same bug waiting for wide enough content.
 *
 * `grid-cols-1` is `minmax(0, 1fr)`, a track that is the screen's width and
 * no wider, so what does not fit scrolls or wraps inside it.
 */

const ROOTS = ["src/app", "src/core/components", "src/themes", "module-sources", "module-template"];
const BREAKPOINT_COLUMNS = /^(sm|md|lg|xl|2xl):grid-cols-/;

/** The class tokens on one line, split the way Tailwind reads a class list. */
function tokens(line: string): string[] {
    return line.split(/[\s"'`{}()]+/).filter(Boolean);
}

export function leavesThePhoneColumnOpen(line: string): boolean {
    const classes = tokens(line);
    return classes.includes("grid")
        && classes.some((c) => BREAKPOINT_COLUMNS.test(c))
        && !classes.some((c) => c.startsWith("grid-cols-"));
}

describe("a grid says how wide its phone column is", () => {
    it("tells an open phone column from a stated one", () => {
        expect(leavesThePhoneColumnOpen(`<div className="grid lg:grid-cols-3 gap-6">`)).toBe(true);
        expect(leavesThePhoneColumnOpen(`className={cn("grid md:grid-cols-2", className)}`)).toBe(true);
        expect(leavesThePhoneColumnOpen(`<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">`)).toBe(false);
        expect(leavesThePhoneColumnOpen(`<div className="grid grid-cols-2 md:grid-cols-4">`)).toBe(false);
        // Not a grid until the breakpoint, so nothing is laid out in columns below it.
        expect(leavesThePhoneColumnOpen(`<div className="md:grid md:grid-cols-2">`)).toBe(false);
    });

    it("finds no grid that leaves it open", () => {
        const grids = grepTree(process.cwd(), "grid-cols-", ROOTS, [".tsx", ".ts"])
            .filter((hit) => !hit.includes("/generated/"));
        expect(grids.length, "the scan read no grid at all").toBeGreaterThan(50);

        const open = grids.filter((hit) => {
            const line = hit.slice(hit.indexOf(":", hit.indexOf(":") + 1) + 1);
            return stripComments(line).trim() !== "" && leavesThePhoneColumnOpen(line);
        });
        expect(open).toEqual([]);
    });
});
