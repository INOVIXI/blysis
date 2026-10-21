// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { relativePath, stripComments } from "./source-text";

/**
 * A mock replaces a module that exists.
 *
 * Vitest accepts `vi.mock` of any path, real or not, and says nothing when
 * nothing imports it. Three store tests mocked `@/modules/store/lib/email`
 * after the code had moved to `./order-email`, so the real mailer ran instead,
 * and the test that made the email fail was watching a mock nobody called. Two
 * more mocked `./NewOrderForm` relative to the test file rather than to the
 * page that imports it, so the form they meant to switch off rendered anyway.
 *
 * This resolves every mocked specifier the way vitest.config.mts does and
 * asks that something is there.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const MOCK = /\bvi\.(?:mock|doMock|unmock|doUnmock)\(\s*["'`]([^"'`]+)["'`]/g;
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", ".json", "/index.ts", "/index.tsx", "/index.js"];

function testFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) testFiles(full, out);
        else if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(full);
    }
    return out;
}

/** The file a specifier names, through the same aliases the test run uses. */
function candidates(specifier: string, from: string): string[] {
    if (specifier.startsWith(".")) return [path.resolve(path.dirname(from), specifier)];
    const installed = specifier.match(/^@\/modules\/([^/]+)(.*)$/);
    if (installed) {
        const [, id, rest] = installed;
        return [path.join(ROOT, "src/modules", id) + rest, path.join(ROOT, "module-sources", id) + rest];
    }
    if (specifier.startsWith("@/")) return [path.join(ROOT, "src", specifier.slice(2))];
    const parts = specifier.split("/");
    const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
    return [path.join(ROOT, "node_modules", name)];
}

function exists(specifier: string, from: string): boolean {
    if (specifier.startsWith("node:") || builtinModules.includes(specifier)) return true;
    return candidates(specifier, from).some((base) => EXTENSIONS.some((ext) => fs.existsSync(base + ext)));
}

const mocks = testFiles(path.join(ROOT, "tests")).flatMap((file) =>
    [...stripComments(fs.readFileSync(file, "utf8")).matchAll(MOCK)].map((match) => ({ file, specifier: match[1] })),
);

describe("a mock", () => {
    it("names a module the test run can resolve", () => {
        const dead = mocks
            .filter(({ file, specifier }) => !exists(specifier, file))
            .map(({ file, specifier }) => `${relativePath(ROOT, file)}: ${specifier}`);

        expect(dead, "nothing imports a path that is not there; mock the module the code under test imports").toEqual([]);
    });

    it("is read from enough tests for that to mean something", () => {
        expect(mocks.length).toBeGreaterThan(500);
    });
});
