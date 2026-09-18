import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { shouldRecheckSession, SESSION_RECHECK_INTERVAL_SECONDS } from "@/core/lib/session-recheck";

/**
 * A ban, a deletion, a demotion and a revoked device have to reach a session
 * that is already open.
 *
 * Under the JWT strategy nothing about a session is stored server-side: the
 * cookie carries the user id, the role and the priority, and Auth.js hands
 * them back on every request without asking the database anything. The `jwt`
 * callback is the only place that can look, and it looked under
 * `trigger === "update" || !token.role || token.rolePriority === undefined`.
 *
 * None of those is ever true again after a sign-in. The credentials provider
 * returns `role: user.role?.name || "member"` and `rolePriority ?? 0`, so
 * both are set and neither is falsy; `trigger` is "update" only when the
 * client calls `update()` itself, because @auth/core passes a trigger only
 * when isUpdate (see lib/actions/session.js). The config asked
 * `session.updateAge` to force an hourly refresh, but Auth.js reads updateAge
 * in the database-session branch only, so under `jwt` it is dead config.
 *
 * So the database was consulted exactly once, at sign-in, and everything
 * decided from the token stayed frozen for the life of the cookie: up to
 * thirty days for a session that ticked "keep me signed in", twenty-four
 * hours otherwise. Banning an account did not sign it out. Anonymising it
 * under the right to be forgotten did not sign it out. An admin demoted to
 * member stayed an admin. And `UserSession.isRevoked`, the column behind
 * "sign out this device" and "sign out everywhere" on the sessions screen,
 * was read in exactly one place: the block that no longer ran. Both buttons
 * wrote a row and changed nothing.
 *
 * The token now records when it was last checked, and is checked again once
 * that stamp is older than the interval: bounded staleness stated in one
 * place, instead of unbounded staleness nothing stated at all.
 */

const ROOT = process.cwd();
const AUTH = fs.readFileSync(path.join(ROOT, "src/core/lib/auth.ts"), "utf8");

/** A token in the shape a signed-in credentials user carries. */
const signedIn = (checkedAt?: number) => ({ role: "member", rolePriority: 0, checkedAt });

const NOW = 1_800_000_000_000;
const INTERVAL_MS = SESSION_RECHECK_INTERVAL_SECONDS * 1000;

describe("shouldRecheckSession", () => {
    it("checks a token that has never been checked", () => {
        // Every token minted before this existed is in this state, and so is
        // one handed back from an impersonation swap.
        expect(shouldRecheckSession(signedIn(), undefined, NOW)).toBe(true);
        expect(shouldRecheckSession({ role: "member", rolePriority: 0 }, undefined, NOW)).toBe(true);
    });

    it("does not check again immediately after a check", () => {
        expect(shouldRecheckSession(signedIn(NOW), undefined, NOW)).toBe(false);
        expect(shouldRecheckSession(signedIn(NOW - 1000), undefined, NOW)).toBe(false);
    });

    it("checks again once the interval has passed", () => {
        expect(shouldRecheckSession(signedIn(NOW - INTERVAL_MS), undefined, NOW)).toBe(true);
        expect(shouldRecheckSession(signedIn(NOW - INTERVAL_MS - 1), undefined, NOW)).toBe(true);
        expect(shouldRecheckSession(signedIn(NOW - INTERVAL_MS + 1), undefined, NOW)).toBe(false);
    });

    it("bounds how long a ban can go unnoticed", () => {
        // The property that matters, stated as a number: no signed-in token
        // survives longer than this after the row behind it changes.
        expect(SESSION_RECHECK_INTERVAL_SECONDS).toBeLessThanOrEqual(300);
        const aDay = 24 * 60 * 60 * 1000;
        expect(shouldRecheckSession(signedIn(NOW - aDay), undefined, NOW)).toBe(true);
        expect(shouldRecheckSession(signedIn(NOW - 30 * aDay), undefined, NOW)).toBe(true);
    });

    it("still checks on an explicit update, whatever the stamp says", () => {
        expect(shouldRecheckSession(signedIn(NOW), "update", NOW)).toBe(true);
    });

    it("keeps the two conditions the old code had", () => {
        // A token with no role, or no priority, was never trusted and is not
        // trusted now either.
        expect(shouldRecheckSession({ rolePriority: 0, checkedAt: NOW }, undefined, NOW)).toBe(true);
        expect(shouldRecheckSession({ role: "", rolePriority: 0, checkedAt: NOW }, undefined, NOW)).toBe(true);
        expect(shouldRecheckSession({ role: "member", checkedAt: NOW }, undefined, NOW)).toBe(true);
    });

    it("does not trust a stamp it cannot read", () => {
        for (const checkedAt of ["yesterday", null, NaN, Infinity, {}, true]) {
            expect(shouldRecheckSession({ role: "member", rolePriority: 0, checkedAt }, undefined, NOW)).toBe(true);
        }
    });

    it("checks when the stamp is in the future", () => {
        // A clock that moved backwards would otherwise park the token past
        // every interval it will ever be compared against.
        expect(shouldRecheckSession(signedIn(NOW + 60_000), undefined, NOW)).toBe(true);
    });

    it("checks a token that is not there at all", () => {
        expect(shouldRecheckSession(null, undefined, NOW)).toBe(true);
        expect(shouldRecheckSession(undefined, undefined, NOW)).toBe(true);
    });
});

describe("the jwt callback", () => {
    it("asks the policy rather than testing the token inline", () => {
        expect(AUTH).toContain("shouldRecheckSession(token, trigger)");
        // The condition that could not come true twice.
        expect(AUTH).not.toContain('trigger === "update" || !token.role');
    });

    it("stamps the token when it has actually looked", () => {
        // Without the stamp the check either never repeats or repeats on
        // every single request; the interval means nothing until it is
        // written down.
        expect(AUTH).toContain("token.checkedAt = Date.now();");
    });

    it("still ends the session on every condition it used to", () => {
        const block = AUTH.slice(AUTH.indexOf("shouldRecheckSession(token, trigger)"));
        const head = block.slice(0, block.indexOf("originalUserId"));
        expect(head).toContain("isDeleted");
        expect(head).toContain("sess?.isRevoked");
        // A user row that is gone entirely used to fall through and keep the
        // token; now it ends the session like every other missing identity.
        expect(head).toContain("if (!dbUser)");
    });

    it("asks what the member may do rather than reading the ban column itself", () => {
        // The recheck is what ends a session somebody is already holding, so
        // it has to see a restriction that arrived while they were signed in -
        // including one a module holds. Reading `isBanned` saw core's half
        // only: a member banned on the punishment record kept their session
        // until they signed out of their own accord.
        const block = AUTH.slice(AUTH.indexOf("shouldRecheckSession(token, trigger)"));
        const head = block.slice(0, block.indexOf("originalUserId"));
        expect(head).toContain("memberStanding");
        expect(head).toContain("mayEnter");
    });

    it("reads the columns it needs rather than the whole user row", () => {
        // It runs on a schedule now, so it must not pull the password hash
        // and every module column into memory to read three booleans.
        const block = AUTH.slice(AUTH.indexOf("shouldRecheckSession(token, trigger)"));
        expect(block.slice(0, 500)).not.toContain("include: { role: true }");
        expect(block.slice(0, 500)).toContain("isBanned: true");
    });

    it("drops the stamp when the token changes whose it is", () => {
        // Impersonation rewrites id and role in place. A stamp vouching for
        // the admin must not vouch for the account they stepped into.
        //
        // There are two stamps now. The token's own is written back to the
        // browser by nothing, so the process keeps its own copy, and a swap
        // that cleared only the first would leave the second answering for
        // the wrong account until the interval ran out.
        const start = AUTH.indexOf("token.originalUserId = token.id;");
        const stop = AUTH.indexOf("token.originalUserId = undefined;");
        expect(start).toBeGreaterThan(-1);
        expect(stop).toBeGreaterThan(-1);
        for (const swap of [AUTH.slice(start, start + 700), AUTH.slice(stop, stop + 300)]) {
            expect(swap).toContain("token.checkedAt = undefined;");
            expect(swap).toContain("forgetChecked(");
        }
    });

    it("does not claim updateAge refreshes anything", () => {
        // It is read in the database-session branch only. The comment saying
        // it forced an hourly refresh is why nobody looked at the condition.
        expect(AUTH).not.toContain("Force a token refresh every hour");
    });
});

describe("the sessions screen", () => {
    const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

    it("has a revocation flag that something actually reads", () => {
        expect(read("src/app/api/v1/sessions/[id]/route.ts")).toContain("isRevoked: true");
        expect(read("src/app/api/v1/sessions/revoke-all/route.ts")).toContain("isRevoked: true");
        expect(AUTH).toContain("sess?.isRevoked");
    });
});
