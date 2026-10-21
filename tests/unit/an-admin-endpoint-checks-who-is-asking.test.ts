/**
 * Two questions nothing was asking of a new endpoint.
 *
 * An admin route that forgets its permission check is not a bug anyone sees:
 * it works perfectly for the administrator who wrote it, and the person it
 * lets in is the one who never reports it. The same is true of a payment
 * callback that trusts what was posted to it, except there the reward is
 * money.
 *
 * Both were verified by hand and both were clean. That is exactly when the
 * check is worth writing down, because the next endpoint is the one nobody
 * reads twice.
 *
 * A provider callback cannot be authenticated the way a normal route is:
 * whoever posts it has no session. It has to prove the message another way,
 * either by verifying a signature the provider computed, or by throwing the
 * message away and asking the provider directly with this site's own
 * credentials. Four gateways here do the first and two do the second; both
 * are accepted, and doing neither is not.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { relativePath } from "./source-text";

const ROOT = path.join(__dirname, "../..");

function routesUnder(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...routesUnder(full));
        else if (entry.name === "route.ts") out.push(full);
    }
    return out;
}

const rel = (f: string) => relativePath(ROOT, f);
const read = (f: string) => fs.readFileSync(f, "utf8");

/** Anything that decides whether this caller is allowed, not merely who they are. */
const AUTHORISES = /isAdmin|requirePermission|hasPermission|requireAdmin|adminGuard/;

/**
 * Ending an impersonation is the one admin route an administrator cannot be
 * asked to prove: the session doing it is the impersonated user, who is not
 * one. It still refuses an anonymous caller, and it refuses a caller who is
 * not impersonating, which is the check that belongs there.
 */
const NOT_AN_ADMIN_ACTION = new Set(["src/app/api/v1/admin/impersonate/stop/route.ts"]);

describe("an admin endpoint", () => {
    const routes = routesUnder(path.join(ROOT, "src/app/api/v1/admin"));

    it("finds the admin routes to check", () => {
        expect(routes.length).toBeGreaterThan(20);
    });

    it("asks whether the caller is allowed, not just who they are", () => {
        const unguarded = routes
            .map(rel)
            .filter((f) => !NOT_AN_ADMIN_ACTION.has(f))
            .filter((f) => !AUTHORISES.test(read(path.join(ROOT, f))));

        expect(
            unguarded,
            `These routes under /api/v1/admin never check a permission:\n${unguarded.join("\n")}`,
        ).toEqual([]);
    });

    it("still refuses an anonymous caller on the one route that skips the admin check", () => {
        for (const f of NOT_AN_ADMIN_ACTION) {
            const src = read(path.join(ROOT, f));
            expect(src, `${f} must still authenticate`).toMatch(/await auth\(\)/);
            expect(src, `${f} must refuse a session that is not impersonating`).toMatch(/originalUserId/);
        }
    });
});

describe("a payment callback", () => {
    /** Routes a manifest exposes to a provider, which arrive without a session. */
    const callbacks = fs
        .readdirSync(path.join(ROOT, "module-sources"), { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name.endsWith("-gateway"))
        .flatMap((e) => routesUnder(path.join(ROOT, "module-sources", e.name, "api")))
        .filter((f) => /POST|GET/.test(read(f)) && /@provider-callback/.test(read(f)));

    it("finds the gateway callbacks to check", () => {
        expect(callbacks.length).toBeGreaterThan(3);
    });

    it("proves the message, by signature or by asking the provider", () => {
        // A signature the provider computed, or a lookup made with this
        // site's own credentials. Trusting the posted body is neither.
        const verifies = /createHmac|createHash|timingSafeEqual/;
        // A lookup made with the site's own credentials. The shape that
        // matters is the config being handed to the call, whatever the
        // helper is named: `mollieGet(config, ...)`, `callParam(config, ...)`.
        const asksProvider = /await\s+\w+(?:<[^>]*>)?\(\s*config\b|await\s+fetch\(/;

        const trusting = callbacks
            .filter((f) => {
                const src = read(f);
                return !verifies.test(src) && !asksProvider.test(src);
            })
            .map(rel);

        expect(
            trusting,
            `These provider callbacks settle on what was posted to them:\n${trusting.join("\n")}`,
        ).toEqual([]);
    });
});
