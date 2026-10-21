// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Every SDK entry point the tooling and the docs name is one that exists.
 *
 * `@/core/sdk/blocks` went with the visual page editor in contract 5.0.0. The
 * ESLint message and `validate-module`'s suggestion went on telling a module
 * author to import from it, the README listed it among the entry points, and
 * `migrate-module-imports` still mapped a symbol onto it, so the codemod meant
 * to fix a module's imports would have written one that cannot resolve.
 *
 * The places that tell an author where to import from are read for every
 * `@/core/sdk/<entry>` and every `@/core/sdk/{a,b,...}` list they spell.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SDK_DIR = path.join(ROOT, "src/core/sdk");

/** Where an author is told which entry points there are. */
const TELLERS = [
    "README.md",
    "module-template/README.md",
    "eslint.config.mjs",
    "scripts/validate-module.ts",
    "scripts/migrate-module-imports.ts",
];

function namedEntries(text: string): string[] {
    const single = [...text.matchAll(/@\/core\/sdk\/([a-z-]+)\b(?!\.)/g)].map((m) => m[1]);
    const lists = [...text.matchAll(/@\/core\/sdk\/\{([a-z,\s-]+)\}/g)].flatMap((m) =>
        m[1].split(",").map((s) => s.trim()),
    );
    return [...single, ...lists];
}

describe("an SDK entry point an author is pointed at", () => {
    it("exists", () => {
        const missing = TELLERS.flatMap((rel) =>
            [...new Set(namedEntries(fs.readFileSync(path.join(ROOT, rel), "utf8")))]
                .filter((entry) => !fs.existsSync(path.join(SDK_DIR, `${entry}.ts`)))
                .map((entry) => `${rel}: @/core/sdk/${entry}`),
        );

        expect(missing).toEqual([]);
    });

    it("is read from places that still name some", () => {
        for (const rel of TELLERS) {
            expect(namedEntries(fs.readFileSync(path.join(ROOT, rel), "utf8")).length, rel).toBeGreaterThan(0);
        }
    });
});
