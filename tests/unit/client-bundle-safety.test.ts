/**
 * Server-only code reaching a browser bundle.
 *
 * A `"use client"` file and everything it imports is compiled for the
 * browser - including the far side of a dynamic `import()`, which the
 * bundler still has to resolve even though it loads it lazily. If any of
 * that reaches `next/headers`, `fs` or `@prisma/client`, the production
 * build fails outright with "Module not found" or "This API is only
 * available in Server Components".
 *
 * That is exactly what happened when the auth challenge landed: the three
 * auth forms imported one constant from `auth-challenge.ts`, whose other
 * export dynamically imports the hook bus, which reaches the database, the
 * logger and the storage layer. Three build errors, seven import traces,
 * and nothing at all in `npm run typecheck`, `lint` or `test` to say so -
 * the failure only showed up three minutes into `npm run build`.
 *
 * So this gate builds the same graph the bundler does and fails on the same
 * edge, in a second. The client-safe names now live in
 * `auth-challenge-shared.ts`; `auth-challenge.ts` is the server half.
 *
 * Barrels are modelled the way a bundler treats them: a file whose entire
 * body is `export { … } from "…"` re-exports gets followed only along the
 * names actually asked for. That is what keeps `@/core/sdk` importable from
 * a client component - `formatDate` pulls in `utils.ts` and nothing else,
 * even though the same barrel also re-exports the hook bus.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, dirname, resolve as resolvePath, relative } from "path";
import { stripComments } from "./source-text";

const ROOT = join(__dirname, "../..");
const SCANNED = ["src", "module-sources"];

/**
 * Specifiers that cannot exist in a browser bundle. Node builtins that Next
 * polyfills (`path`, `buffer`, `util`) are deliberately absent - they build
 * fine and saying otherwise would be a false alarm.
 */
const SERVER_ONLY = new Set([
    "server-only",
    "next/headers",
    "fs",
    "fs/promises",
    "node:fs",
    "node:fs/promises",
    "child_process",
    "node:child_process",
    "async_hooks",
    "node:async_hooks",
    "net",
    "node:net",
    "dns",
    "node:dns",
    "@prisma/client",
    "nodemailer",
    "bcryptjs",
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) sourceFiles(full, out);
        else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
    }
    return out;
}

const ALL = SCANNED.flatMap((d) => sourceFiles(join(ROOT, d)));
const rel = (f: string) => relative(ROOT, f);
const read = (f: string) => readFileSync(f, "utf-8");

/** Resolve an import specifier the way the tsconfig path alias does. */
function resolveSpec(spec: string, fromFile: string): string | null {
    let base: string;
    if (spec.startsWith("@/")) base = join(ROOT, "src", spec.slice(2));
    else if (spec.startsWith(".")) base = resolvePath(dirname(fromFile), spec);
    else return null;
    for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
        if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return null;
}

interface Parsed {
    /** Specifiers pulled in whenever any part of this module is used. */
    edges: string[];
    /** Exported name -> the specifier it is re-exported from. */
    reexports: Map<string, string>;
    starReexport: boolean;
    /** False for a pure re-export barrel, which a bundler shakes per name. */
    hasOwnCode: boolean;
}

const parsed = new Map<string, Parsed>();
function parse(file: string): Parsed {
    const cached = parsed.get(file);
    if (cached) return cached;
    const src = read(file);
    const edges: string[] = [];
    const reexports = new Map<string, string>();
    let starReexport = false;
    let body = src;

    // Value imports only - `import type` is erased before bundling.
    for (const m of src.matchAll(/(?:^|\n)\s*import\s+(?!type\s)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g)) edges.push(m[1]);
    for (const m of src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) edges.push(m[1]);
    for (const m of src.matchAll(/(?:^|\n)\s*export\s+(type\s+)?\{([^}]*)\}\s*from\s+["']([^"']+)["']/g)) {
        body = body.replace(m[0], "");
        if (m[1]) continue;
        for (const part of m[2].split(",")) {
            const name = part.trim().split(/\s+as\s+/).pop()?.trim();
            if (name) reexports.set(name, m[3]);
        }
    }
    for (const m of src.matchAll(/(?:^|\n)\s*export\s+\*\s*from\s+["']([^"']+)["']/g)) {
        starReexport = true;
        edges.push(m[1]);
    }

    const stripped = stripComments(body)
        .replace(/(?:^|\n)\s*import\s[^;]*;?/g, "")
        .replace(/;/g, ""); // semicolons left behind by a removed re-export
    const out = { edges, reexports, starReexport, hasOwnCode: /\S/.test(stripped) };
    parsed.set(file, out);
    return out;
}

type Wanted = Set<string> | "*";

/** Which names a file asks for from one specifier. */
function importedNames(src: string, spec: string): Wanted {
    const escaped = spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const names = new Set<string>();
    for (const m of src.matchAll(new RegExp(`import\\s+([^"';]*?)\\sfrom\\s+["']${escaped}["']`, "g"))) {
        const clause = m[1];
        // A default or namespace import can reach anything the module exports.
        if (/^\s*\*/.test(clause) || !clause.includes("{")) return "*";
        for (const part of clause.slice(clause.indexOf("{") + 1, clause.lastIndexOf("}")).split(",")) {
            const n = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
            if (n) names.add(n);
        }
    }
    return names.size ? names : "*";
}

/** Walk the browser graph from one entry, collecting server-only edges. */
function serverOnlyReach(entry: string): { module: string; spec: string; chain: string[] }[] {
    const found: { module: string; spec: string; chain: string[] }[] = [];
    const seen = new Set<string>();
    const queue: [string, Wanted, string[]][] = [[entry, "*", [rel(entry)]]];
    while (queue.length) {
        const [cur, want, chain] = queue.shift()!;
        const key = `${cur}|${want === "*" ? "*" : [...want].sort().join(",")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const info = parse(cur);
        const src = read(cur);
        const specs = new Set<string>();
        // Anything with a body of its own is bundled whole; only a pure
        // re-export barrel can be narrowed to the names asked for.
        if (want === "*" || info.hasOwnCode || info.starReexport) for (const e of info.edges) specs.add(e);
        for (const name of want === "*" ? info.reexports.keys() : want) {
            const s = info.reexports.get(name);
            if (s) specs.add(s);
            else if (want !== "*" && !info.hasOwnCode) for (const e of info.edges) specs.add(e);
        }
        for (const spec of specs) {
            if (SERVER_ONLY.has(spec)) {
                found.push({ module: rel(cur), spec, chain });
                continue;
            }
            const next = resolveSpec(spec, cur);
            if (next) queue.push([next, importedNames(src, spec), [...chain, rel(next)]]);
        }
    }
    return found;
}

/**
 * Does this file open with the client directive?
 *
 * Scanned rather than matched. The pattern was a starred alternation of
 * comment shapes with `\s*` inside it, so a file with a long comment header
 * and no directive after it backtracked exponentially - the scanner hung on
 * the build instead of reporting one.
 *
 * The rule is the same as the bundler's: skip whitespace and leading comments,
 * then the first thing must be the directive.
 */
function isClientEntry(src: string): boolean {
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") { i += 1; continue; }
        if (ch === "/" && src[i + 1] === "/") {
            const end = src.indexOf("\n", i);
            if (end === -1) return false;
            i = end + 1;
            continue;
        }
        if (ch === "/" && src[i + 1] === "*") {
            const end = src.indexOf("*/", i + 2);
            if (end === -1) return false;
            i = end + 2;
            continue;
        }
        return src.startsWith('"use client"', i) || src.startsWith("'use client'", i);
    }
    return false;
}

const CLIENT_ENTRIES = ALL.filter((f) => isClientEntry(read(f)));

describe("client bundle safety", () => {
    it("finds the client components to check", () => {
        expect(CLIENT_ENTRIES.length).toBeGreaterThan(100);
    });

    // Walking every client entry's import graph is the slowest check in the
    // suite, and vitest's five-second default made it fail on a loaded
    // machine rather than on a real offender. A gate that goes red for the
    // wrong reason is a gate people learn to ignore.
    it("no client component reaches server-only code", { timeout: 60_000 }, () => {
        const offenders: string[] = [];
        for (const entry of CLIENT_ENTRIES) {
            for (const hit of serverOnlyReach(entry)) {
                offenders.push(`${hit.module} imports "${hit.spec}"\n    ${hit.chain.join("\n -> ")}`);
            }
        }
        expect(
            offenders,
            `These import chains put server-only code in a browser bundle and fail "npm run build":\n\n${offenders.join("\n\n")}`,
        ).toEqual([]);
    });

    it("keeps the auth challenge split honest", () => {
        // The shared half is what the three auth forms import; the server
        // half is what reaches the hook bus. If they ever merge again the
        // build breaks, so assert both sides of the line directly.
        //
        // The server half used to be provably server-only through the bus,
        // which reached the database and the logger. It no longer does: the
        // bus had to become client-safe on its own so `next dev` could
        // compile the SDK barrel. What still separates the two halves is the
        // import itself, so that is what this asserts now.
        const shared = join(ROOT, "src/core/lib/auth-challenge-shared.ts");
        const server = join(ROOT, "src/core/lib/auth-challenge.ts");
        expect(serverOnlyReach(shared)).toEqual([]);
        expect(parse(shared).edges).not.toContain("./hooks");
        expect(parse(server).edges).toContain("./hooks");
    });

    it("keeps the hook bus clean on its own", () => {
        // The barrel model above is how a production bundler behaves, and
        // `npm run build` proves it: a client component that asks for
        // `formatDate` never pays for the hook bus. `next dev` does not
        // shake per name, so it compiles the whole barrel and every file it
        // re-exports, and the bus reached the activity feed through a
        // dynamic import, which reaches the database, the logger and
        // `async_hooks`. Nothing in build, typecheck, lint or this suite
        // said so; the dev server just answered 500 on every page once a
        // module put a client component in front of the barrel.
        //
        // The bus is isomorphic by contract, so it has to be clean without
        // help from a bundler. The server half lives in `hooks-bootstrap.ts`.
        expect(serverOnlyReach(join(ROOT, "src/core/lib/hooks.ts"))).toEqual([]);
    });

    it("keeps @/core/sdk a pure re-export barrel", () => {
        // Eleven module client components import this barrel. It stays
        // importable from the browser only while a bundler can drop the
        // re-exports they do not name - which stops being true the moment
        // the file grows a declaration of its own.
        const info = parse(join(ROOT, "src/core/sdk/index.ts"));
        expect(info.hasOwnCode, "src/core/sdk/index.ts must contain only `export { … } from` re-exports").toBe(false);
        expect(info.reexports.size).toBeGreaterThan(5);
    });
});
