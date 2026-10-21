/**
 * A malformed request body is the caller's mistake, not a server fault.
 *
 * `request.json()` throws on a body that is not JSON - truncated, wrong
 * content, or absent. In an App Router route handler an uncaught throw is a
 * 500 with no body. Eighty-seven routes answered that way, and twenty more
 * let a broad handler `catch` turn it into their own "Internal server
 * error". The platform ships an OpenAPI document and API keys, so the
 * callers are not only its own forms, and a 500 both misleads them and files
 * the request as a server error where the health alerting can see it.
 *
 * Eleven routes had already worked it out and hand-rolled the same
 * `let body: unknown; try { … } catch { return 400 }`, in four different
 * wordings. `readJsonBody` is that block once, and this gate keeps every
 * route on it.
 *
 * This gate allows the two shapes a route used to say its body was optional:
 * `request.json().catch(() => ({}))` and `.catch(() => null)`, and the same
 * statement written longer as a try whose catch supplies the body itself. It
 * forbids a bare `request.json()` with nothing to catch the throw.
 *
 * Nothing uses those shapes any more. A `.catch` also gives up the size cap
 * that `readJsonBody` reads the body under, so an optional body now says so
 * with `readJsonBody(request, { fallback: {} })` and keeps the cap;
 * `tests/unit/json-body-is-bounded.test.ts` is the stricter rule that forbids
 * `request.json()` in a route at all. This gate stays as the narrower
 * statement of why: an uncaught parse is a 500 for the caller's mistake.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { relativePath } from "./source-text";

const ROOT = join(__dirname, "../..");
const SCANNED = ["src/app/api", "module-sources"];

function routeFiles(dir: string, out: string[] = []): string[] {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) routeFiles(full, out);
        else if (entry === "route.ts") out.push(full);
    }
    return out;
}

const ROUTES = SCANNED.flatMap((d) => routeFiles(join(ROOT, d)));
const read = (f: string) => readFileSync(f, "utf-8");
const rel = (f: string) => relativePath(ROOT, f);

const JSON_CALL = /\b(?:request|req)\s*\.\s*json\s*\(\s*\)/g;

/** Is this `.json()` call inside a try block that has not been closed yet? */
function insideTry(source: string, index: number): boolean {
    const before = source.slice(0, index);
    const fnStart = Math.max(
        before.lastIndexOf("export async function"),
        before.lastIndexOf("export function"),
    );
    const seg = before.slice(fnStart);
    return (seg.match(/\btry\s*\{/g) ?? []).length > (seg.match(/\}\s*catch\b/g) ?? []).length;
}

describe("JSON request bodies", () => {
    it("finds the routes to check", () => {
        expect(ROUTES.length).toBeGreaterThan(150);
    });

    it("never calls request.json() with nothing to catch the throw", () => {
        const offenders: string[] = [];
        for (const file of ROUTES) {
            const source = read(file);
            for (const m of source.matchAll(JSON_CALL)) {
                const after = source.slice(m.index + m[0].length, m.index + m[0].length + 10);
                if (/^\s*\.catch\b/.test(after)) continue;
                if (insideTry(source, m.index)) continue;
                const line = source.slice(0, m.index).split("\n").length;
                offenders.push(`${rel(file)}:${line}`);
            }
        }
        expect(
            offenders,
            `A malformed body makes these routes throw, which Next answers with a 500. Use readJsonBody:\n${offenders.join("\n")}`,
        ).toEqual([]);
    });

    it("guards every readJsonBody call with the sentinel check", () => {
        // `readJsonBody` returns either the parsed body or the 400 to send.
        // TypeScript cannot enforce the check, because the parsed half is
        // `any` (see src/core/lib/api-body.ts). So it is checked here: the
        // guard must follow on the next line.
        const offenders: string[] = [];
        for (const file of ROUTES) {
            const lines = read(file).split("\n");
            for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(/(?:const|let)\s+(\w+)\s*=\s*(?:\()?await readJsonBody\(/);
                if (!m) continue;
                const next = lines[i + 1] ?? "";
                if (!new RegExp(`if\\s*\\(${m[1]} instanceof NextResponse\\)\\s*return ${m[1]};`).test(next)) {
                    offenders.push(`${rel(file)}:${i + 1}`);
                }
            }
        }
        expect(
            offenders,
            `Missing "if (body instanceof NextResponse) return body;" after readJsonBody:\n${offenders.join("\n")}`,
        ).toEqual([]);
    });

    it("modules reach the helper through the SDK, not core internals", () => {
        const offenders = ROUTES.filter(
            (f) => rel(f).startsWith("module-sources/") && read(f).includes("@/core/lib/api-body"),
        ).map(rel);
        expect(offenders).toEqual([]);
    });

    it("keeps one wording for the error", async () => {
        const { INVALID_JSON_BODY } = await import("@/core/lib/api-body");
        expect(INVALID_JSON_BODY).toEqual({ error: "Invalid JSON body", code: "invalid_json" });

        // No route may hand-roll its own version of the same 400 any more.
        const offenders: string[] = [];
        for (const file of ROUTES) {
            const source = read(file);
            if (/status:\s*400[^\n]*\}\s*\)\s*;/.test(source) && /"Invalid JSON/.test(source)) {
                offenders.push(rel(file));
            }
        }
        expect(offenders, `Use readJsonBody instead of a hand-rolled Invalid JSON 400:\n${offenders.join("\n")}`).toEqual([]);
    });
});

describe("readJsonBody", () => {
    it("returns the parsed body for valid JSON", async () => {
        const { readJsonBody } = await import("@/core/lib/api-body");
        const request = new Request("http://localhost/api", {
            method: "POST",
            body: JSON.stringify({ name: "x" }),
            headers: { "content-type": "application/json" },
        });
        expect(await readJsonBody(request)).toEqual({ name: "x" });
    });

    it("returns a 400 for a malformed body instead of throwing", async () => {
        const { readJsonBody, INVALID_JSON_BODY } = await import("@/core/lib/api-body");
        const { NextResponse } = await import("next/server");
        for (const body of ["{oops", "", "not json at all"]) {
            const request = new Request("http://localhost/api", {
                method: "POST",
                body,
                headers: { "content-type": "application/json" },
            });
            const result = await readJsonBody(request);
            expect(result, JSON.stringify(body)).toBeInstanceOf(NextResponse);
            const response = result as InstanceType<typeof NextResponse>;
            expect(response.status).toBe(400);
            expect(await response.json()).toEqual(INVALID_JSON_BODY);
        }
    });

    it("passes through a body that is valid JSON but not an object", async () => {
        // The caller validates the shape; the helper only decides whether
        // the bytes were JSON at all.
        const { readJsonBody } = await import("@/core/lib/api-body");
        const request = new Request("http://localhost/api", {
            method: "POST",
            body: "null",
            headers: { "content-type": "application/json" },
        });
        expect(await readJsonBody(request)).toBeNull();
    });
});
