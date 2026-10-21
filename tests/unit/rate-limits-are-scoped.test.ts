import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { rateLimit } from "../../src/core/lib/rate-limit";
import { relativePath, stripComments } from "./source-text";

/**
 * Two things about rate limiting were true and should not have been.
 *
 * First, `withRateLimit` hit the limiter with the bare client IP as the key,
 * so every route wrapped in it shared one counter. A licence server checking
 * keys from an office spent the same budget the people behind that NAT needed
 * to search the site or sign in through Steam, and a route asking for a
 * tighter limit could not have one, because the count it read was everybody's.
 * Every hand-written call already prefixed its key - `register:`,
 * `gift-redeem:`, `2fa-verify:` - so the wrapper was the only way to get an
 * unscoped bucket. It now takes the scope as its first argument.
 *
 * Second, sixteen mutating handlers reachable by any signed-in account had no
 * limit at all: adding to a cart, placing an order, liking a post, editing a
 * forum post. That last one writes a Revision row per edit holding the whole
 * previous body, retained for a year, so an edit loop was a way for an
 * ordinary member to grow the database without bound.
 *
 * The scan below is deliberately narrow. It asks only that a handler which
 * writes on behalf of a signed-in non-admin account names a limit, and it
 * accepts any of the three the platform ships.
 */

const ROOT = path.resolve(__dirname, "../..");

const HANDLER = /export (?:async function|const) (GET|POST|PATCH|PUT|DELETE)\b/g;
const HAS_LIMIT = /rateLimit\w*\(|withRateLimit/;
const ADMIN_ONLY = /isAdmin|isStaff|hasPermission|hasResourcePermission|denyUnlessAdmin|requireAdmin/;
const AUTHENTICATED = /await auth\(\)/;

type Handler = { file: string; verb: string; body: string; head: string };

function routeFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name === "route.ts") out.push(full);
        }
    };
    for (const base of ["src/app/api", "module-sources"]) walk(path.join(ROOT, base));
    return out;
}

/**
 * The code of a route, without its comments or imports. A helper above the
 * handlers that checks for an admin or takes a limit speaks for the handlers
 * that call it; an `import { isAdmin }` nobody calls, or a comment saying
 * `rateLimit(` used to be here, does not.
 */
function codeOf(source: string): string {
    return stripComments(source).replace(/^\s*import\s[^;]*;?/gm, "");
}

export function splitHandlers(file: string, raw: string): Handler[] {
    const source = codeOf(raw);
    const starts = [...source.matchAll(HANDLER)].map((m) => ({ at: m.index, verb: m[1] }));
    const head = starts.length > 0 ? source.slice(0, starts[0].at) : source;
    return starts.map((s, i) => ({
        file,
        verb: s.verb,
        head,
        body: source.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : source.length),
    }));
}

/** Mutating handlers a signed-in non-admin can reach that name no limit. */
export function unlimitedUserWrites(handlers: Handler[]): string[] {
    return handlers
        .filter((h) => h.verb !== "GET")
        .filter((h) => !HAS_LIMIT.test(h.body) && !HAS_LIMIT.test(h.head))
        .filter((h) => AUTHENTICATED.test(h.body))
        .filter((h) => !ADMIN_ONLY.test(h.body) && !ADMIN_ONLY.test(h.head))
        .map((h) => `${h.file} ${h.verb}`);
}

describe("rate limits", () => {
    const handlers = routeFiles().flatMap((file) =>
        splitHandlers(relativePath(ROOT, file), fs.readFileSync(file, "utf8")),
    );

    it("finds the handlers to check", () => {
        expect(handlers.length).toBeGreaterThan(300);
        expect(handlers.filter((h) => HAS_LIMIT.test(h.body)).length).toBeGreaterThan(20);
    });

    it("leaves no signed-in write path without one", () => {
        expect(unlimitedUserWrites(handlers).join("\n")).toBe("");
    });

    it("gives every withRateLimit call a fixed scope", () => {
        const calls: string[] = [];
        for (const handler of handlers) {
            for (const m of handler.body.matchAll(/withRateLimit\(\s*([^,\n]*)/g)) {
                calls.push(`${handler.file}: ${m[1].trim()}`);
            }
        }
        expect(calls.length).toBeGreaterThan(5);
        for (const call of calls) {
            // A quoted literal, never a template string or anything off the request.
            expect(call, call).toMatch(/: "[a-z0-9-]+"$/);
        }
    });

    it("builds the wrapper's key from the scope and the IP", () => {
        const helper = fs.readFileSync(path.join(ROOT, "src/core/lib/api-utils.ts"), "utf8");
        expect(helper).toContain("rateLimit(`${scope}:${ip}`, config)");
        expect(helper).toMatch(/export function withRateLimit\(\s*\n?\s*scope: string,/);
    });

    it("keys every limit it does declare by scope, never by a bare identifier", () => {
        const bare: string[] = [];
        for (const handler of handlers) {
            for (const m of handler.body.matchAll(/rateLimit(?:Strict|ForRole|ForRoleAsync)?\(\s*([^,\n]+),/g)) {
                const key = m[1].trim();
                if (key.startsWith("`") || key.startsWith('"')) {
                    // An inline key has to carry a scope prefix of its own.
                    if (!/^[`"][a-z0-9-]+:/.test(key)) bare.push(`${handler.file}: ${key}`);
                    continue;
                }
                // A named key is fine as long as it was built with a prefix here.
                const binding = new RegExp(`const ${key} = [^;]*[\`"][a-z0-9-]+:`).test(handler.body);
                if (!binding) bare.push(`${handler.file}: ${key}`);
            }
        }
        expect(bare).toEqual([]);
    });

    it("builds a rate limit key from the trust-aware client IP", () => {
        // x-forwarded-for is set by the caller. Three modules read it directly
        // and keyed their limit on it, so a fresh header bought a fresh budget
        // and the limit stopped being one. getClientIP only honours it from a
        // peer in TRUSTED_PROXY_IPS.
        const offenders = handlers
            .filter((h) => /x-forwarded-for/.test(h.body) || /x-forwarded-for/.test(h.head))
            .map((h) => `${h.file} ${h.verb}`);
        expect([...new Set(offenders)]).toEqual([]);
    });
});

describe("two scopes do not share a bucket", () => {
    it("counts them apart", async () => {
        const config = { maxRequests: 2, windowMs: 60_000 };
        const ip = `203.0.113.${Math.floor(Math.random() * 200)}`;
        expect((await rateLimit(`scope-a:${ip}`, config)).success).toBe(true);
        expect((await rateLimit(`scope-a:${ip}`, config)).success).toBe(true);
        expect((await rateLimit(`scope-a:${ip}`, config)).success).toBe(false);
        // The second scope starts from a full budget, which is the whole point.
        expect((await rateLimit(`scope-b:${ip}`, config)).success).toBe(true);
    });

    it("still counts one scope per caller", async () => {
        const config = { maxRequests: 1, windowMs: 60_000 };
        expect((await rateLimit("scope-c:198.51.100.1", config)).success).toBe(true);
        expect((await rateLimit("scope-c:198.51.100.1", config)).success).toBe(false);
        expect((await rateLimit("scope-c:198.51.100.2", config)).success).toBe(true);
    });
});

describe("the scan itself", () => {
    const limited = `
export async function POST(request: NextRequest) {
    const session = await auth();
    const allowed = await rateLimitForRoleAsync(\`x:\${session.user.id}\`, cfg, session.user.role);
}
`;
    const unlimited = `
export async function POST(request: NextRequest) {
    const session = await auth();
    await prisma.thing.create({ data: {} });
}
`;
    const adminOnly = `
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!(await isAdmin(session.user.id))) return forbidden;
}
`;
    const reads = `
export async function GET() {
    const session = await auth();
    return NextResponse.json({});
}
`;

    it("catches an unlimited signed-in write", () => {
        expect(unlimitedUserWrites(splitHandlers("a.ts", unlimited))).toEqual(["a.ts POST"]);
    });

    it("accepts a limited one", () => {
        expect(unlimitedUserWrites(splitHandlers("a.ts", limited))).toEqual([]);
    });

    it("leaves an admin-only handler alone", () => {
        expect(unlimitedUserWrites(splitHandlers("a.ts", adminOnly))).toEqual([]);
    });

    it("leaves reads alone", () => {
        expect(unlimitedUserWrites(splitHandlers("a.ts", reads))).toEqual([]);
    });

    it("is not talked out of it by an import or a comment above the handlers", () => {
        const excused = `
import { isAdmin } from "@/core/sdk/server";
// rateLimit( used to guard this route
${unlimited}`;
        expect(unlimitedUserWrites(splitHandlers("a.ts", excused))).toEqual(["a.ts POST"]);
    });

    it("lets a helper above the handlers speak for the ones that call it", () => {
        const helped = `
async function gate() {
    const session = await auth();
    return isAdmin(session.user.id);
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!(await gate())) return forbidden;
    await prisma.thing.create({ data: {} });
}
`;
        expect(unlimitedUserWrites(splitHandlers("a.ts", helped))).toEqual([]);
    });
});
