// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A coverage floor holds a file that exists.
 *
 * Vitest applies a per-file threshold to the files its glob matches and is
 * silent when it matches none. sanitize.ts kept a 100% floor for months
 * after the sanitiser moved into markdown.ts, so the file that guards every
 * page a person wrote on had no floor at all, and the config still read as
 * though it did.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

/** The per-file keys of `coverage.thresholds`: a quoted path opening an object. */
const config = fs.readFileSync(path.join(ROOT, "vitest.config.mts"), "utf8");
const thresholds = config.slice(config.indexOf("thresholds:"));
const files = [...thresholds.matchAll(/['"]((?:src|scripts)\/[^'"]+)['"]\s*:\s*\{/g)].map((m) => m[1]);

describe("a coverage floor", () => {
    it("names a file the suite can measure", () => {
        const gone = files.filter((file) => !fs.existsSync(path.join(ROOT, file)));
        expect(gone, "move the floor to the file that does this work now, or drop it with the file").toEqual([]);
    });

    it("is read from the config the suite runs with", () => {
        expect(files.length).toBeGreaterThan(20);
    });
});
