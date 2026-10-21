import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { relativePath } from "./source-text";

/**
 * Core's catalogue is the strings core actually says.
 *
 * `a-module-ships-no-string-it-never-says.test.ts` does this for the modules
 * and left core alone, on the grounds that a dead string costs less here: it
 * is not written into anybody's database at install time. It still costs
 * something. A key that no screen reads is a key a translator translates, a
 * reviewer reads, and the next person copies.
 *
 * Six had gone quiet, and five of them the same way: the key was renamed and
 * the old name stayed. `metrics_total` while the screen reads
 * `metrics_totalRequests`, `sidebar_theme` while the nav declares
 * `sidebar_themeLibrary`, and three more. A substring search hides exactly
 * this, which is why the match below is on a whole word.
 *
 * A key counts as said if its last segment appears as a word anywhere in the
 * tree, or if some template literal can build it: the breadcrumb reads
 * `crumb_${slug}` and the settings screens read `adm_${field}`, and neither
 * name appears in full anywhere.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

function flatten(node: Record<string, unknown>, prefix = ""): string[] {
    return Object.entries(node).flatMap(([key, value]) =>
        value && typeof value === "object" && !Array.isArray(value)
            ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
            : [`${prefix}${key}`],
    );
}

function sourceFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || relativePath(ROOT, full) === "src/modules") continue;
            sourceFiles(full, out);
        } else if (/\.(ts|tsx|mjs|json|prisma)$/.test(full)) {
            out.push(full);
        }
    }
    return out;
}

describe("core's catalogue", () => {
    it("says nothing no screen reads", () => {
        const catalogue = flatten(
            JSON.parse(fs.readFileSync(path.join(ROOT, "messages-core/en.json"), "utf8")),
        );
        const text = ["src", "module-sources", "scripts", "prisma"]
            .flatMap((d) => sourceFiles(path.join(ROOT, d)))
            .map((f) => fs.readFileSync(f, "utf8"))
            .join("\n");

        // Whole words, so `metrics_total` is not counted as read by a screen
        // that says `metrics_totalRequests`.
        const words = new Set(text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
        // `crumb_${slug}` means every key starting `crumb_` may be built.
        const builders = [...(text.match(/`([A-Za-z][A-Za-z0-9_.]*?)\$\{/g) ?? [])].map((m) =>
            m.slice(1, -2),
        );

        const silent = catalogue.filter((key) => {
            const leaf = key.split(".").pop()!;
            if (words.has(leaf)) return false;
            return !builders.some((prefix) => prefix && leaf.startsWith(prefix));
        });

        expect(catalogue.length, "core should have a catalogue to check").toBeGreaterThan(1000);
        expect(
            silent,
            `these are translated into every locale and read by nothing:\n${silent.join("\n")}`,
        ).toEqual([]);
    });
});
