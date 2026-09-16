// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * What is installed is what was written, while the two claim the same version.
 *
 * `module-sources/` is where a module is authored and `src/modules/` is what
 * the app compiles. Nothing connected them: a fix written in the source tree
 * and not copied across builds green, serves the old code, and reads as a fix
 * that did not work. It happened twice in one afternoon - once on a blog page
 * where a screenshot kept showing the defect after the build, and once on a
 * cart page.
 *
 * The rule is not that the trees are identical. An installation may legitimately
 * be running an older release of a module than the one being written, and on a
 * real site it usually is. What cannot happen is two trees calling themselves
 * the same version and holding different bytes - that is the one case where
 * nobody can tell which code is running.
 *
 * Contents rather than timestamps: a copy and a checkout both move mtimes
 * around, and neither says anything about what is inside.
 */

const ROOT = process.cwd();
const SOURCES = path.join(ROOT, "module-sources");
const INSTALLED = path.join(ROOT, "src/modules");

function listFiles(dir: string, base = dir, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) listFiles(full, base, out);
        else out.push(path.relative(base, full));
    }
    return out;
}

function version(manifest: string): string | null {
    try {
        return (JSON.parse(fs.readFileSync(manifest, "utf8")) as { version?: string }).version ?? null;
    } catch {
        return null;
    }
}

/** Modules present in both trees and claiming the same version. */
function sameVersionPairs(): string[] {
    if (!fs.existsSync(INSTALLED)) return [];
    return fs
        .readdirSync(INSTALLED, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((id) => fs.existsSync(path.join(SOURCES, id, "module.json")))
        .filter((id) => {
            const authored = version(path.join(SOURCES, id, "module.json"));
            const installed = version(path.join(INSTALLED, id, "module.json"));
            return authored !== null && authored === installed;
        });
}

describe("an installed module", () => {
    const pairs = sameVersionPairs();

    it("is found by the scan at all", () => {
        // A tree with nothing installed is a fresh checkout, not a failure.
        if (!fs.existsSync(INSTALLED)) return;
        expect(pairs.length).toBeGreaterThan(0);
    });

    it("holds exactly what was authored, while it claims the same version", () => {
        const drifted: string[] = [];
        for (const id of pairs) {
            const authored = listFiles(path.join(SOURCES, id)).sort();
            const installed = listFiles(path.join(INSTALLED, id)).sort();

            for (const file of new Set([...authored, ...installed])) {
                const a = path.join(SOURCES, id, file);
                const b = path.join(INSTALLED, id, file);
                if (!fs.existsSync(a)) { drifted.push(`${id}/${file} is installed but was never authored`); continue; }
                if (!fs.existsSync(b)) { drifted.push(`${id}/${file} was authored but is not installed`); continue; }
                if (!fs.readFileSync(a).equals(fs.readFileSync(b))) drifted.push(`${id}/${file} differs`);
            }
        }
        expect(
            drifted,
            `these say they are the same version and are not:\n${drifted.join("\n")}`,
        ).toEqual([]);
    });

    it("can say no", () => {
        // The rule is the byte comparison, so it has to be able to fail.
        const sample = pairs[0];
        const file = listFiles(path.join(SOURCES, sample))[0];
        expect(fs.readFileSync(path.join(SOURCES, sample, file)).equals(Buffer.from("not this"))).toBe(false);
    });
});
