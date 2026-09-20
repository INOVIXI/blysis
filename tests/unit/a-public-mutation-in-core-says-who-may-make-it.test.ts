import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-text";

/**
 * Core's own endpoints are held to the rule its modules are held to.
 *
 * A module's provider callbacks already have two gates: `validate-module`
 * rejects one that neither verifies a signature nor carries a
 * `@provider-callback: <why>`, and `provider-callback-csrf.test.ts` says the
 * same thing from the suite. Both read `module-sources` and stop there.
 *
 * Core answers on the same origin with the same authority and nothing checked
 * it. Measured across 241 route files: core has two endpoints that mutate
 * without a session, and both are sound - the webhook dispatcher verifies an
 * HMAC in constant time inside a replay window, and setup refuses as soon as
 * one user row exists. Neither fact is written anywhere a gate can read, so a
 * third such endpoint would land green.
 *
 * A route passes by doing one of four things: limiting its caller,
 * authenticating them, proving the request came from who it claims, or saying
 * in a `@public-mutation:` line why it needs none of those. The tag is the
 * same shape as `@provider-callback:` and carries the same obligation: a
 * reason, not a marker.
 *
 * ## Reads were not asked the same question
 *
 * Only writes were checked here, which left a hole an audit found on
 * 2026-09-20: `/api/v1/modules/marketplace` and `/api/v1/themes/marketplace`
 * answered anybody. Both are read by one screen each in the admin panel,
 * `_catalog.ts` calls the first "admin-facing" in its own words, and both
 * fetch a remote index - so an anonymous caller got the list of everything
 * this site can install and made it go and get one.
 *
 * A read is not a write, so the bar is lower: a public read that is bounded
 * and says so passes. But it has to say so, in a `@public-read:` line, for
 * the same reason a write does - the next one lands green otherwise.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const API_DIR = path.join(ROOT, "src/app/api");

/** Comments hide a keyword as easily as they explain one. */
function withoutComments(source: string): string {
    return stripComments(source);
}

function routeFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) routeFiles(full, out);
        else if (entry.name === "route.ts") out.push(full);
    }
    return out;
}

const HANDLER = /export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
/** `rateLimitForRoleAsync` was missing, so the health probe read as unguarded
 *  while limiting itself to thirty a minute. */
const LIMITED = /\b(withRateLimit|rateLimitForRoleAsync|rateLimitForRole|rateLimit)\s*\(/;
const AUTHENTICATED = /\bawait\s+auth\(\)|getSession\(|isAdmin\(|requireAdmin|requirePermission|hasPermission/;
const PROVES_THE_SENDER = /timingSafeEqual|constructEvent|verifyWebhookSignature/;
/** A reason, not just the marker: the same rule validate-module applies. */
const DECLARED = /@public-mutation:[ \t]*\S+/;
/** The same obligation for a read that answers anybody on purpose. */
const DECLARED_READ = /@public-read:[ \t]*\S+/;
/** Setup answers once and then refuses, which is a guard of its own kind. */
const BEFORE_SETUP = /isSetupComplete\s*\(|user\.count\s*\(/;

describe("a core endpoint that changes something", () => {
    const routes = routeFiles(API_DIR).map((file) => {
        const raw = fs.readFileSync(file, "utf8");
        const code = withoutComments(raw);
        const methods = [...code.matchAll(HANDLER)].map((m) => m[1]);
        return {
            path: path.relative(ROOT, file),
            mutates: methods.some((m) => m !== "GET"),
            guarded:
                LIMITED.test(code) || AUTHENTICATED.test(code) || PROVES_THE_SENDER.test(code)
                || BEFORE_SETUP.test(code),
            declared: DECLARED.test(raw),
            declaredRead: DECLARED_READ.test(raw),
        };
    });

    it("finds the core API surface to check", () => {
        expect(routes.length).toBeGreaterThan(50);
        expect(routes.some((r) => r.mutates)).toBe(true);
    });

    it("limits, authenticates or proves its caller, or says why it need not", () => {
        const open = routes
            .filter((r) => r.mutates && !r.guarded && !r.declared)
            .map((r) => r.path);

        expect(
            open,
            `These change state for an unauthenticated caller with nothing in the way.\n` +
            `Add rateLimit(), an auth check, a signature check, or a\n` +
            `"@public-mutation: <why>" line stating what makes it safe:\n${open.join("\n")}`,
        ).toEqual([]);
    });

    it("does the same for a read, which answers anybody just as freely", () => {
        const open = routes
            .filter((r) => !r.guarded && !r.declared && !r.declaredRead)
            .map((r) => r.path);

        expect(
            open,
            `These answer an unauthenticated caller with nothing in the way.\n` +
            `Add a rate limit, an auth check, or a\n` +
            `"@public-read: <why>" line stating what makes it safe:\n${open.join("\n")}`,
        ).toEqual([]);
    });

    it("accepts no declaration that is only a marker", () => {
        const empty = routes
            .filter((r) => r.declared)
            .filter((r) => !DECLARED.test(fs.readFileSync(path.join(ROOT, r.path), "utf8")))
            .map((r) => r.path);
        expect(empty).toEqual([]);
    });
});
