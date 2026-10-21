import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { relativePath } from "./source-text";

/**
 * A failure inside a request is logged where that request can be found again.
 *
 * `log` is not a nicer `console`. It emits JSON lines in production and it
 * carries a correlation id, bound once in the proxy and propagated through
 * `AsyncLocalStorage`, so every line a request produces can be gathered back
 * into that request, however deep in a module hook it was written. It also
 * respects `LOG_LEVEL`.
 *
 * `console.error` has none of that. It writes one bare line with no id, no
 * level and no shape, and an operator reading the log of a failure has no way
 * to join it to the request that caused it. Forty two of those were spread
 * over twenty three endpoints.
 *
 * The rule is scoped to where a request exists. A client component has no
 * correlation id and cannot import the logger anyway, since it reaches
 * `next/headers` and `async_hooks`, so a `"use client"` file is left alone.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCANNED = ["src/app", "module-sources"];

/**
 * Core's own server code, where a failure is furthest from the request that
 * caused it and the correlation id is worth the most: the scheduler, the hook
 * bus, the module loader.
 */
const CORE = "src/core/lib";

/**
 * Files under `src/core/lib` that a `"use client"` file imports, so the
 * logger cannot go in them: it reaches `next/headers` and `async_hooks`, and
 * `client-bundle-safety.test.ts` fails the moment either lands in a browser
 * bundle. They keep the console, which is what a browser has anyway.
 *
 * `hooks.ts` is here for the same reason by a longer road: `@/core/sdk`
 * re-exports it, and that entry is isomorphic, so anything it pulls in is
 * compiled for the browser. `hooks-bootstrap.ts` exists precisely because the
 * two halves once shared a file and `next dev` answered 500 on every page
 * whose client graph touched the barrel.
 *
 * `logger.ts` is here for a different reason: it is what writes the line.
 */
const REACHED_FROM_A_BROWSER = new Set([
    "src/core/lib/logger.ts",
    "src/core/lib/hooks.ts",
    "src/core/lib/blocks-merger.ts",
    "src/core/lib/secret-storage.ts",
    "src/core/lib/module-cache.ts",
    "src/core/lib/cache.ts",
    "src/core/lib/rate-limit.ts",
    "src/core/lib/activity-log.ts",
    "src/core/lib/email.ts",
    "src/core/lib/revisions.ts",
]);

/**
 * Any mention of the console, called or handed on. `.catch(console.error)`
 * loses the request the same way a direct call does, and it was the shape
 * six of these took.
 */
const CONSOLE = /\bconsole\.(log|error|warn|info|debug)\b/;

/** A line that only talks about the console is not one that writes to it. */
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

/** Every `.ts` under a directory, tests aside. */
function serverFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) serverFiles(full, out);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
    }
    return out;
}

function routeFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) routeFiles(full, out);
        else if (entry.name === "route.ts") out.push(full);
    }
    return out;
}

describe("an endpoint", () => {
    it("writes its failures where the request can be found again", () => {
        const bare: string[] = [];
        for (const base of SCANNED) {
            for (const file of routeFiles(path.join(ROOT, base))) {
                const source = fs.readFileSync(file, "utf8");
                if (source.slice(0, 200).includes('"use client"')) continue;
                source.split("\n").forEach((line, i) => {
                    if (CONSOLE.test(line) && !COMMENT.test(line)) {
                        bare.push(`${relativePath(ROOT, file)}:${i + 1}  ${line.trim().slice(0, 80)}`);
                    }
                });
            }
        }
        expect(
            bare,
            `these write to the console, so an operator cannot join them to the request that caused them. Use log.error / log.warn:\n${bare.join("\n")}`,
        ).toEqual([]);
    });

    it("writes them the same way inside core, where the request is furthest away", () => {
        const bare: string[] = [];
        for (const file of serverFiles(path.join(ROOT, CORE))) {
            const relative = relativePath(ROOT, file);
            if (REACHED_FROM_A_BROWSER.has(relative)) continue;
            const source = fs.readFileSync(file, "utf8");
            if (source.slice(0, 200).includes('"use client"')) continue;
            source.split("\n").forEach((line, i) => {
                const trimmed = line.trim();
                if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
                if (CONSOLE.test(line)) bare.push(`${relative}:${i + 1}  ${trimmed.slice(0, 80)}`);
            });
        }
        expect(
            bare,
            `these write to the console from inside core, so nothing joins them to the request that caused them:\n${bare.join("\n")}`,
        ).toEqual([]);
    });

    it("writes them the same way inside a module, where the work is done", () => {
        // A module's cron jobs, hooks, search handlers and libraries run on the
        // server too, and a hook runs inside the request that triggered it, so
        // its lines belong to that request as much as a route's do. A module
        // file marked `"use client"` is skipped: it has no correlation id and
        // cannot import the logger, which reaches next/headers.
        const bare: string[] = [];
        for (const file of serverFiles(path.join(ROOT, "module-sources"))) {
            if (path.basename(file) === "route.ts") continue;
            const source = fs.readFileSync(file, "utf8");
            if (source.slice(0, 200).includes('"use client"')) continue;
            source.split("\n").forEach((line, i) => {
                const trimmed = line.trim();
                if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
                if (CONSOLE.test(line)) {
                    bare.push(`${relativePath(ROOT, file)}:${i + 1}  ${trimmed.slice(0, 80)}`);
                }
            });
        }
        expect(
            bare,
            `these write to the console from inside a module, so nothing joins them to the request that caused them:\n${bare.join("\n")}`,
        ).toEqual([]);
    });

    it("is looked for in the endpoints that exist", () => {
        const count = SCANNED.reduce((n, b) => n + routeFiles(path.join(ROOT, b)).length, 0);
        expect(count).toBeGreaterThan(100);
    });
});
