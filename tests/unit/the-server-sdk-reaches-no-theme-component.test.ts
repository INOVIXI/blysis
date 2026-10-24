/**
 * The server SDK never reaches a theme's components.
 *
 * Nearly every route imports `@/core/sdk/server`, an API route for the
 * database as much as a page. When it re-exported `ArrangedPage`, every one of
 * those routes pulled in the frame, the shell and the theme components it
 * loads with `next/dynamic`. A route that never draws a page then had a server
 * build naming client chunks its own client build never wrote: the homepage
 * preloaded four files that answered 404, under every theme. Drawing a page
 * belongs in `@/core/sdk/page`, imported only by the pages that draw one.
 *
 * The walk follows `@/` and relative imports from the entry and fails if any
 * path reaches the generated theme component registry.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { relativePath, stripComments } from "./source-text";

const ROOT = process.cwd();
const THEME_COMPONENTS = path.join(ROOT, "src/core/generated/theme-components.tsx");
/** `import`/`export ... from`, a type-only one marked; a dynamic `import()`; a bare `import "x"`. */
const STATEMENT = /\b(?:import|export)\s+(type\s+)?[^;'"]*?\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g;

function resolve(spec: string, from: string): string | null {
    const base = spec.startsWith("@/") ? path.join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
    if (!base) return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
}

/** Every file the entry reaches, each with the chain of files that led to it. */
function reach(entry: string): Map<string, string[]> {
    const seen = new Map<string, string[]>([[entry, [entry]]]);
    const queue = [entry];
    while (queue.length > 0) {
        const file = queue.shift() as string;
        const source = stripComments(fs.readFileSync(file, "utf8"));
        for (const match of source.matchAll(STATEMENT)) {
            if (match[1]) continue;
            const next = resolve(match[2] ?? match[3] ?? match[4], file);
            if (!next || seen.has(next)) continue;
            seen.set(next, [...(seen.get(file) ?? []), next]);
            queue.push(next);
        }
    }
    return seen;
}

describe("the server SDK", () => {
    const reached = reach(path.join(ROOT, "src/core/sdk/server.ts"));

    it("is walked far enough to mean something", () => {
        expect(reached.size).toBeGreaterThan(50);
    });

    it("reaches no theme component, so a route that only reads data loads none", () => {
        const chain = reached.get(THEME_COMPONENTS)?.map((file) => relativePath(ROOT, file));
        expect(chain, chain?.join("\n  -> ")).toBeUndefined();
    });

    it("finds the registry from an entry that does draw a page, so the walk can fail", () => {
        expect(reach(path.join(ROOT, "src/core/components/layout/PageFrame.tsx")).has(THEME_COMPONENTS)).toBe(true);
    });
});
