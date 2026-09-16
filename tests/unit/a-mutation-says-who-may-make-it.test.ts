// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CORE_PERMISSIONS, isPermissionName } from "@/core/lib/permission-names";
import { CORE_ADMIN_API, MEMBER_MUTATIONS, API_DISPATCHER } from "@/core/lib/admin-api";
import { stripComments } from "./source-text";

/**
 * Every write says who may make it.
 *
 * `a-public-mutation-in-core-says-who-may-make-it` already asks the weaker
 * question - does this route check anything at all - and the answer was
 * usually `isAdmin`. That is one bit of information: administrator or not.
 * With it, an operator cannot hand somebody the moderation queue without
 * handing them the database backups as well.
 *
 * Each write now names the permission that allows it, and the enforcement
 * reads the same table the panel's screens read. A route missing from both
 * tables fails here rather than being reachable by accident, because deny by
 * default in the enforcement would make it reachable by nobody, silently.
 *
 * The second table is as important as the first: a member changing their own
 * password, revoking their own session or uploading their own picture is a
 * write that no permission should gate, and saying so in a list with a reason
 * each is how that stays a decision rather than an omission.
 */

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, "src/app/api/v1");

/** Routes that export something other than GET, as the path that reaches them. */
function mutatingRoutes(dir: string, prefix = ""): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...mutatingRoutes(full, `${prefix}/${entry.name}`));
        } else if (entry.name === "route.ts") {
            const source = stripComments(fs.readFileSync(full, "utf8"));
            const methods = [
                ...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g),
                ...source.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)/g),
            ].map((match) => match[1]);
            if (methods.some((method) => method !== "GET")) out.push(prefix);
        }
    }
    return out;
}

// Below `/api`, which is how `admin-api.ts` spells them: the table and the
// directory tree keep one spelling so neither has to be translated.
const ROUTES = mutatingRoutes(API_DIR, "/v1").sort();
const DECLARED = new Map(CORE_ADMIN_API.map((entry) => [entry.path, entry.permission]));
const ARGUED = new Map(MEMBER_MUTATIONS.map((entry) => [entry.path, entry.reason]));

describe("a mutation in core", () => {
    it("finds the endpoints, so a broken scan cannot pass quietly", () => {
        expect(ROUTES.length).toBeGreaterThan(50);
        expect(CORE_ADMIN_API.length).toBeGreaterThan(30);
        expect(MEMBER_MUTATIONS.length).toBeGreaterThan(5);
    });

    it("names the permission that allows it, or argues that it needs none", () => {
        const silent = ROUTES.filter((route) => route !== API_DISPATCHER)
            .filter((route) => !DECLARED.has(route) && !ARGUED.has(route));
        expect(silent, "a write nobody declared is a write nobody can make").toEqual([]);
    });

    it("names a permission that exists and has the one shape", () => {
        const core = new Set<string>(CORE_PERMISSIONS);
        const wrong = CORE_ADMIN_API.filter(
            (entry) => !isPermissionName(entry.permission) || !core.has(entry.permission),
        ).map((entry) => `${entry.path}: ${entry.permission}`);
        expect(wrong).toEqual([]);
    });

    it("gives every member-facing write a real reason", () => {
        const thin = MEMBER_MUTATIONS.filter((entry) => entry.reason.length < 40).map((entry) => entry.path);
        expect(thin, "a reason short enough to be a label is not a reason").toEqual([]);
    });

    it("says each route once", () => {
        const both = [...DECLARED.keys()].filter((route) => ARGUED.has(route));
        expect(both, "a route is either gated or argued, not both").toEqual([]);
    });

    it("keeps no row for a route that has gone", () => {
        const live = new Set(ROUTES);
        const stale = [...DECLARED.keys(), ...ARGUED.keys()].filter((route) => !live.has(route)).sort();
        expect(stale).toEqual([]);
    });

    it("leaves the module dispatcher to the module that declared the endpoint", () => {
        expect(ROUTES).toContain(API_DISPATCHER);
        expect(DECLARED.has(API_DISPATCHER)).toBe(false);
        expect(ARGUED.has(API_DISPATCHER)).toBe(false);
    });
});
