import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { bucketFor, defaultBucket, perMinute } from "@/core/lib/module-api-limits";
import { moduleManifestSchema } from "@/core/lib/module-manifest-schema";
import { RATE_LIMIT_API, RATE_LIMIT_PROVIDER_CALLBACK } from "@/core/lib/constants";

/**
 * The module API surface had no rate limit at all.
 *
 * Core's ninety-seven routes each call the limiter themselves. That works
 * because they are all in this repository and a reviewer sees the omission.
 * The hundred and sixty-five module endpoints are written by whoever wrote
 * the module, and not one of them was limited: a form submission, a vote
 * claim, a wheel spin and every payment callback answered as fast as the
 * network could ask. The dispatcher applies the limit for all of them now,
 * and a manifest may tighten it but may not turn it off.
 */

const root = path.resolve(import.meta.dirname, "../..");
const dispatcher = fs.readFileSync(
    path.join(root, "src/app/api/v1/[...path]/route.ts"),
    "utf8",
);

describe("the module API dispatcher", () => {
    it("rate limits", () => {
        expect(dispatcher).toContain("rateLimitForRoleAsync");
        expect(dispatcher).toContain("bucketFor");
    });

    it("limits before it loads the handler, not after", () => {
        const limited = dispatcher.indexOf("rateLimitForRoleAsync");
        const loaded = dispatcher.indexOf("ModuleApiRegistry[match.key]");
        expect(limited).toBeGreaterThan(-1);
        expect(loaded).toBeGreaterThan(-1);
        expect(limited).toBeLessThan(loaded);
    });

    it("answers 429 with a Retry-After, not a bare refusal", () => {
        expect(dispatcher).toContain("status: 429");
        expect(dispatcher).toContain("Retry-After");
        expect(dispatcher).toContain("rate_limited");
    });

    // Per endpoint means per handler file. This asserted `match.key`, which is
    // built from the URL, and a manifest may declare one handler at several
    // paths - fifteen do, and each spelling opened its own budget. See
    // tests/unit/aliased-endpoints-share-a-budget.test.ts.
    it("keys the bucket per endpoint and per caller", () => {
        expect(dispatcher).toMatch(/`module-api:\$\{bucketKeyFor\(match\)\}:\$\{caller\.id\}`/);
    });

    it("counts a signed-in caller by id and everyone else by address", () => {
        expect(dispatcher).toContain("`user:${userId}`");
        expect(dispatcher).toContain("`ip:${ip}`");
    });

    it("does not decode a session for a provider callback, which never has one", () => {
        expect(dispatcher).toMatch(/match\.providerCallback \|\| !hasSessionCookie\(req\)/);
    });
});

describe("the bucket an endpoint gets", () => {
    it("is the API limit by default", () => {
        expect(bucketFor({})).toEqual(RATE_LIMIT_API);
    });

    it("is the roomier callback limit for an endpoint a provider posts to", () => {
        expect(bucketFor({ providerCallback: true })).toEqual(RATE_LIMIT_PROVIDER_CALLBACK);
    });

    it("gives a provider more room than a browser, so a burst never delays a settlement", () => {
        expect(perMinute(defaultBucket(true))).toBeGreaterThan(perMinute(defaultBucket(false)));
    });

    it("takes a manifest's stricter number", () => {
        expect(bucketFor({ rateLimit: { maxRequests: 30, windowMs: 60_000 } })).toEqual({
            maxRequests: 30,
            windowMs: 60_000,
        });
    });

    it("refuses a manifest that asks for a laxer one", () => {
        const lax = bucketFor({ rateLimit: { maxRequests: 100_000, windowMs: 1_000 } });
        expect(perMinute(lax)).toBeLessThanOrEqual(perMinute(RATE_LIMIT_API));
    });

    it("cannot be turned off by any manifest value", () => {
        for (const rateLimit of [
            { maxRequests: 10_000, windowMs: 1_000 },
            { maxRequests: 9_999, windowMs: 3_600_000 },
        ]) {
            expect(Number.isFinite(perMinute(bucketFor({ rateLimit })))).toBe(true);
            expect(perMinute(bucketFor({ rateLimit }))).toBeLessThanOrEqual(
                perMinute(RATE_LIMIT_API),
            );
        }
    });
});

describe("the manifest field", () => {
    const base = {
        id: "demo",
        name: "Demo",
        description: "d",
        version: "1.0.0",
        coreVersion: "^1.0.0",
        category: "utility",
        author: "a",
    };
    const withApi = (rateLimit: unknown) => ({
        ...base,
        api: [{ path: "/demo", handler: "api/route.ts", rateLimit }],
    });

    it("accepts a sane limit", () => {
        expect(moduleManifestSchema.safeParse(withApi({ maxRequests: 30, windowMs: 60_000 })).success).toBe(true);
    });

    it("is optional", () => {
        expect(
            moduleManifestSchema.safeParse({ ...base, api: [{ path: "/demo", handler: "api/route.ts" }] }).success,
        ).toBe(true);
    });

    it("rejects zero requests, which would be a closed endpoint dressed as a limit", () => {
        expect(moduleManifestSchema.safeParse(withApi({ maxRequests: 0, windowMs: 60_000 })).success).toBe(false);
    });

    it("rejects a window shorter than a second or longer than an hour", () => {
        expect(moduleManifestSchema.safeParse(withApi({ maxRequests: 5, windowMs: 10 })).success).toBe(false);
        expect(moduleManifestSchema.safeParse(withApi({ maxRequests: 5, windowMs: 7_200_000 })).success).toBe(false);
    });

    it("rejects a partial limit", () => {
        expect(moduleManifestSchema.safeParse(withApi({ maxRequests: 5 })).success).toBe(false);
    });
});

describe("what the modules in this repository declare", () => {
    const manifests = fs
        .readdirSync(path.join(root, "module-sources"), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => ({
            module: e.name,
            file: path.join(root, "module-sources", e.name, "module.json"),
        }))
        .filter((m) => fs.existsSync(m.file))
        .map((m) => ({ ...m, manifest: JSON.parse(fs.readFileSync(m.file, "utf8")) }));

    const endpoints = manifests.flatMap((m) =>
        ((m.manifest.api ?? []) as { path: string; rateLimit?: { maxRequests: number; windowMs: number }; providerCallback?: boolean }[]).map(
            (api) => ({ module: m.module, ...api }),
        ),
    );

    it("scans the whole surface", () => {
        expect(endpoints.length).toBeGreaterThan(100);
    });

    it("leaves no endpoint above the default", () => {
        const over = endpoints
            .map((e) => ({ e, rpm: perMinute(bucketFor(e)) }))
            .filter(({ e, rpm }) => rpm > perMinute(defaultBucket(e.providerCallback)))
            .map(({ e }) => `${e.module}${e.path}`);
        expect(over).toEqual([]);
    });

    it("tightens the endpoints a player can hammer for gain", () => {
        // Voting no longer pays anything, so `vote/record` mints nothing; it
        // stays tightened because the vote count it writes is what the
        // leaderboard ranks on. Opening a crate draws a prize, as a turn of
        // the wheel does.
        const tightened = endpoints.filter((e) => e.rateLimit).map((e) => `${e.module}${e.path}`);
        expect(tightened.sort()).toEqual(["crates/crates/open", "vote/vote/record", "wheel/wheel/spin"]);
    });
});
