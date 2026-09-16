import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source-text";

/**
 * A panel screen uses the panel it was given.
 *
 * The admin layout hands every screen the full width beside the sidebar. A
 * handful of screens then put a measure back on their own root: the Turnstile
 * and R2 settings opened `max-w-2xl`, the export screen `max-w-md`, and three
 * create forms capped the form inside a card that still stretched, so the
 * card drew a border around an empty right half. On a desktop panel the
 * result was a page that looked broken rather than composed, and the
 * operator's own report was the shortest description of it: half pages.
 *
 * The settled answer is on the rate limits screen. A screen that has more to
 * show than fits one column groups it into cards and lays them out in a grid,
 * rather than stacking one narrow column against the left edge.
 *
 * A measure is still right for some things, and each of those says so in the
 * same class list:
 *
 *   - `w-full` with it. That is a dialog or an error card: it fills whatever
 *     it is centred in, up to a limit. It is not a page shrinking itself.
 *   - `truncate` or an `overflow-` with it. That is a cell clipping a long
 *     value so a table keeps its shape.
 *   - a form control. A search box the width of the page is a worse search
 *     box.
 */

const ROOT = join(__dirname, "..", "..");

const ADMIN_TREES = [
    "src/app/[locale]/(admin)",
    "src/core/components/admin",
    ...listModuleAdminDirs(),
];

function listModuleAdminDirs(): string[] {
    try {
        return execFileSync("sh", ["-c", "ls -d module-sources/*/pages/admin 2>/dev/null"], {
            cwd: ROOT,
            encoding: "utf8",
        })
            .split("\n")
            .filter(Boolean);
    } catch {
        return [];
    }
}

/** Every .tsx under the given trees, repo-relative. */
function tsxFilesIn(trees: string[]): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(join(ROOT, dir), { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const path = `${dir}/${entry.name}`;
            if (entry.isDirectory()) walk(path);
            else if (entry.name.endsWith(".tsx")) out.push(path);
        }
    };
    for (const tree of trees) walk(tree);
    return out.sort();
}

/**
 * Prose about the code is not the code. Two screens explain in a comment why
 * they dropped the measure they used to have, and a gate that read those
 * would fail on the record of its own rule being followed.
 */

/** The whole `className=` value around `at`, delimiters and all. */
function classNameAround(src: string, at: number): string {
    const start = src.lastIndexOf("className=", at);
    if (start === -1) return "";
    const i = start + "className=".length;
    const opener = src[i];
    if (opener === '"' || opener === "'" || opener === "`") {
        const end = src.indexOf(opener, i + 1);
        return end === -1 ? src.slice(i) : src.slice(i + 1, end);
    }
    if (opener === "{") {
        let depth = 0;
        for (let j = i; j < src.length; j++) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}" && --depth === 0) return src.slice(i + 1, j);
        }
    }
    return "";
}

/** The element the attribute at `at` belongs to. */
function tagAround(src: string, at: number): string {
    const open = src.lastIndexOf("<", at);
    return open === -1 ? "" : (src.slice(open + 1).match(/^[A-Za-z][\w.]*/)?.[0] ?? "");
}

/** Controls a person types into. A full width one is harder to use, not easier. */
const CONTROLS = ["Input", "Textarea", "NativeSelect", "Select", "SearchInput", "input", "textarea", "select"];

describe("an admin screen fills the panel", () => {
    it("puts no measure on anything but a dialog, a clipped cell or a control", () => {
        const offenders: string[] = [];

        for (const file of tsxFilesIn(ADMIN_TREES)) {
            const src = stripComments(fs.readFileSync(join(ROOT, file), "utf8"));
            for (const match of src.matchAll(/\bmax-w-/g)) {
                const at = match.index!;
                const classes = classNameAround(src, at);
                if (!classes.includes("max-w-")) continue;
                if (/\bw-full\b/.test(classes)) continue;
                if (/\btruncate\b|\boverflow-/.test(classes)) continue;
                if (CONTROLS.includes(tagAround(src, at))) continue;
                offenders.push(`${file}:${src.slice(0, at).split("\n").length}`);
            }
        }

        expect(
            offenders,
            "the layout already sized this screen; group what it shows into cards instead of narrowing it",
        ).toEqual([]);
    });

    it("reads enough screens for that to mean something", () => {
        expect(tsxFilesIn(ADMIN_TREES).length).toBeGreaterThan(80);
    });
});
