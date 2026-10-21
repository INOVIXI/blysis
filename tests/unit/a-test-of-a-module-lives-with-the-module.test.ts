// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { relativePath, stripComments } from "./source-text";

/**
 * A test that imports a module's code lives in `tests/modules/<id>/`.
 *
 * `tsconfig.json` leaves `tests/modules` out of the type check because a
 * module's code is only typed once the module is installed: its models exist
 * in the Prisma client only then. vitest resolves `@/modules/<id>` to
 * `module-sources/<id>` either way, so a test elsewhere that imports a module
 * runs green, and the type check is the one that pays. Three store tests sat
 * in `tests/unit`, so `npm run typecheck` and `next build` failed on every
 * fresh checkout with fourteen errors about store models missing from
 * `PrismaClient`, and only CI, which installs every module first, never saw
 * them.
 *
 * Reading a module's manifest or source as text is fine anywhere; importing
 * its code is what pulls it into the type check.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCANNED = ["tests/unit", "tests/integration"];
const MODULE_IMPORT = /\b(?:from\s+|import\s*\(\s*)["'`](?:@\/modules\/|(?:\.\.\/)+module-sources\/)[^"'`]+["'`]/g;

function testFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) testFiles(full, out);
        else if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(full);
    }
    return out;
}

describe("a test that imports a module's code", () => {
    it("lives with that module's tests, outside the core type check", () => {
        const misplaced = SCANNED.flatMap((dir) => testFiles(path.join(ROOT, dir))).flatMap((file) =>
            [...stripComments(fs.readFileSync(file, "utf8")).matchAll(MODULE_IMPORT)].map(
                (match) => `${relativePath(ROOT, file)}: ${match[0]}`,
            ),
        );

        expect(misplaced).toEqual([]);
    });
});
