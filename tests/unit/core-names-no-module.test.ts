// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Core names no module and no theme - not in code, not in a comment.
 *
 * The import rules already stop core from reaching into a module, and
 * `validate-module` stops a module reaching past the SDK. Neither of them
 * reads prose, so the rule was kept by hand in comments and quietly stopped
 * being true: seven files in `src/core` named one, as an example of the shape
 * they were describing. A storage provider id was documented as
 * `e.g. "<a provider's id>"`, the account lockout setting credited the module
 * that offers the field, the retention sweep named the module whose table it
 * used to prune, and the sign-in path named the module that adds a second
 * factor.
 *
 * An example is exactly how this goes wrong. Core does not know that module
 * exists; a fork that ships a different one hands the next reader a comment
 * describing software they do not have, and a reader who trusts it writes
 * code that assumes it. The shape is what core knows, so the shape is what a
 * comment may describe.
 *
 * Compound ids only. A module id may be an ordinary word - "store", "blog",
 * "forum" - and a gate that flagged those would flag the sentence explaining
 * why it flagged them. Every id with a hyphen in it is a name nobody writes by
 * accident, which is 60 of them, and that is the check.
 */

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        // Generated files are written from the installed modules and name
        // every one of them by construction. They are not written by hand.
        if (entry.name === "node_modules" || entry.name === "generated") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(full);
    }
    return out;
}

function directories(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
}

const COMPOUND_IDS = [
    ...directories(path.join(ROOT, "module-sources")),
    ...directories(path.join(ROOT, "src/themes")),
].filter((id) => id.includes("-"));

const FILES = [...walk(path.join(ROOT, "src/core")), ...walk(path.join(ROOT, "src/app"))];
const rel = (file: string) => path.relative(ROOT, file);

describe("core", () => {
    it("has modules to be ignorant of, and files to read", () => {
        expect(COMPOUND_IDS.length).toBeGreaterThan(40);
        expect(FILES.length).toBeGreaterThan(300);
    });

    it("names no module and no theme", () => {
        const offenders: string[] = [];
        for (const file of FILES) {
            const source = fs.readFileSync(file, "utf8");
            for (const id of COMPOUND_IDS) {
                if (!new RegExp(`\\b${id}\\b`).test(source)) continue;
                offenders.push(`${rel(file)}: ${id}`);
            }
        }
        expect(offenders, "describe the shape core knows, not the module that has it").toEqual([]);
    });
});
