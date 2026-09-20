import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * An endpoint that reads a whole table says how much of it it will read.
 *
 * `findMany` with neither a `where` to narrow it nor a `take` to cap it
 * returns the table. That is fine for a table whose size is decided when the
 * product is installed - there are as many roles as an operator made and as
 * many module rows as there are modules - and it is a slow leak for a table
 * that fills up while the site is used. Every API key anyone ever created,
 * every coupon the shop ever ran: the query gets heavier every week and
 * nothing says so until an admin screen stops answering.
 *
 * So the rule is not "always paginate". It is: a table that grows with use
 * has a ceiling, and a table that does not is written down here as such. The
 * list below is the whole argument, and adding to it should feel like a
 * decision.
 *
 * There used to be a second list, for the one route that read a whole table
 * on purpose: the CSV export. It does not any more. It reads a page, writes
 * it, and reads the next, which took its peak heap on 100k users from 228.9 MB
 * to 18.1 MB. With the exception gone the mechanism went too - a future export
 * that wants one should have to fail this test and argue for it.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * Models whose row count is set by how the site is configured, not by how
 * much it is used. Reading all of one is reading a handful of rows.
 */
const BOUNDED_BY_DESIGN = new Set([
    "role",           // as many as an operator made
    "moduleConfig",   // one per module in the tree
    "setting",        // core's own configuration
    "cronRun",        // one per registered job
    "blogCategory",   // curated by an editor
    "seoPage",        // one per page an editor described
    "licenseProduct", // one per product a licence can be issued for
    "wheel",          // one per wheel an operator set up, and each is a page
    "helpCategory",   // one per section of the help centre, written by hand
    "gameServer",     // one per machine an operator runs, and each is a host they set up
]);

function routeFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) routeFiles(full, out);
        else if (entry.name === "route.ts") out.push(full);
    }
    return out;
}

/** The `(...)` that starts at or after `from`, balanced. */
function callBody(source: string, from: number): string {
    const open = source.indexOf("(", from);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "(") depth++;
        else if (source[i] === ")" && --depth === 0) return source.slice(open, i + 1);
    }
    return source.slice(open);
}

describe("an endpoint that reads a whole table", () => {
    it("does so only where the table cannot grow with use", () => {
        const unbounded: string[] = [];
        for (const base of ["src/app", "module-sources"]) {
            for (const file of routeFiles(path.join(ROOT, base))) {
                const relative = path.relative(ROOT, file);
                const source = fs.readFileSync(file, "utf8");
                for (const match of source.matchAll(/(\w+)\s*\.\s*findMany\s*\(/g)) {
                    const body = callBody(source, match.index + match[0].length - 1);
                    if (/\btake\b/.test(body) || /\bwhere\b/.test(body)) continue;
                    if (BOUNDED_BY_DESIGN.has(match[1])) continue;
                    const line = source.slice(0, match.index).split("\n").length;
                    unbounded.push(`${relative}:${line} reads every ${match[1]}`);
                }
            }
        }
        expect(
            unbounded,
            `these read a table that fills up while the site is used. Give the query a ceiling, or add the model to BOUNDED_BY_DESIGN and say why:\n${unbounded.join("\n")}`,
        ).toEqual([]);
    });
});
