import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The button already has `gap-2`.
 *
 * A hundred and seventy icons inside buttons carried `mr-2` on top of it, so
 * those buttons put sixteen pixels between the icon and the word where the
 * button on the next screen put eight - which is most of what "the buttons
 * are not proportional" turns out to mean when you go and measure it. Some
 * carried `mr-1`, one carried `ml-2`, and a `size="sm"` button with `mr-2`
 * was wider than its own label.
 *
 * Spacing between a button's children belongs to the button.
 */

const ROOT = join(__dirname, "..", "..");
const ROOTS = ["src/app", "src/core", "src/themes", "module-sources"];

const MARGIN = /\b(?:mr|ml)-(?:0\.5|1|1\.5|2|2\.5|3)\b/;

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next") continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (name.endsWith(".tsx")) out.push(path);
    }
    return out;
}

/**
 * The bodies of every `<Button>`/`<button>` in a file.
 *
 * Deliberately simple: find an opening tag, skip to the end of it (counting
 * braces so a `className={cn(...)}` holding a `>` does not end it early), and
 * take everything up to the matching close. Nested buttons do not happen.
 */
function buttonBodies(source: string): { body: string; at: number }[] {
    const found: { body: string; at: number }[] = [];
    for (const open of ["<Button", "<button"]) {
        const close = open === "<Button" ? "</Button>" : "</button>";
        let i = 0;
        for (;;) {
            i = source.indexOf(open, i);
            if (i < 0) break;
            let j = i + open.length;
            let depth = 0;
            for (; j < source.length; j++) {
                const c = source[j];
                if (c === "{") depth++;
                else if (c === "}") depth--;
                else if (c === '"' && depth === 0) j = source.indexOf('"', j + 1);
                else if (c === ">" && depth === 0) break;
            }
            if (j >= source.length) break;
            if (source[j - 1] === "/") { i = j; continue; }   // self-closing
            const end = source.indexOf(close, j);
            if (end < 0) { i = j; continue; }
            found.push({ body: source.slice(j + 1, end), at: j });
            i = end;
        }
    }
    return found;
}

describe("a button spaces its own icon", () => {
    it("finds buttons to look at", () => {
        /*
         * Counted across everything the rule covers rather than in one file.
         * It used to read the crud shell and expect more than three buttons
         * there, which failed the day two of that screen's buttons moved into
         * a shared component - a refactor the rule has no opinion about.
         */
        let seen = 0;
        for (const root of ROOTS) {
            for (const file of walk(join(ROOT, root))) {
                const source = readFileSync(file, "utf8");
                if (!source.includes("<Button") && !source.includes("<button")) continue;
                seen += buttonBodies(source).length;
            }
        }
        expect(seen).toBeGreaterThan(200);
    });

    it("has no horizontal margins inside a button anywhere", () => {
        const offenders: string[] = [];
        for (const root of ROOTS) {
            for (const file of walk(join(ROOT, root))) {
                const source = readFileSync(file, "utf8");
                if (!source.includes("<Button") && !source.includes("<button")) continue;
                for (const { body, at } of buttonBodies(source)) {
                    const hit = body.match(MARGIN);
                    if (!hit) continue;
                    const line = source.slice(0, at).split("\n").length;
                    offenders.push(`${relative(ROOT, file)}:${line}: ${hit[0]}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
