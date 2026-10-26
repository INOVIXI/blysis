import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * getModuleStates is consulted during SSR and during `next build`'s
 * static-collection phase, where DATABASE_URL may not resolve at all. It
 * therefore has to treat an unreachable database as "no states known" and
 * let consumers default to enabled - returning false there would 404 every
 * module the moment the database blinked. Nothing tested that.
 */

const { moduleConfig, cacheGetJSON, cacheSetJSON, cacheDel } = vi.hoisted(() => ({
    moduleConfig: { findMany: vi.fn() },
    cacheGetJSON: vi.fn(),
    cacheSetJSON: vi.fn(),
    cacheDel: vi.fn(),
}));

vi.mock("@/core/lib/db", () => ({
    prisma: { moduleConfig },
    default: { moduleConfig },
}));

vi.mock("@/core/lib/redis", () => ({ cacheGetJSON, cacheSetJSON, cacheDel }));

// What a manifest declares and how a stored value is clamped is
// module-settings' job and has its own tests. What matters here is which bag
// this file hands over, so the resolver is a spy that reports its arguments.
const { resolveSettings } = vi.hoisted(() => ({ resolveSettings: vi.fn() }));
vi.mock("@/core/lib/module-settings", () => ({ resolveSettings }));

const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
vi.mock("@/core/lib/logger", () => ({
    errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    log: { debug: vi.fn(), info: vi.fn(), warn: logWarn, error: vi.fn() },
}));

import {
    getModuleStates,
    isModuleEnabled,
    invalidateModuleCache,
    moduleSettings,
} from "@/core/lib/module-cache";

beforeEach(() => {
    moduleConfig.findMany.mockReset().mockResolvedValue([]);
    cacheGetJSON.mockReset().mockResolvedValue(null);
    cacheSetJSON.mockReset().mockResolvedValue(undefined);
    cacheDel.mockReset().mockResolvedValue(undefined);
    resolveSettings.mockReset().mockImplementation((_id: string, stored: unknown) => ({ stored }));
    logWarn.mockReset();
    vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("getModuleStates", () => {
    it("serves a cache hit without touching the database", async () => {
        cacheGetJSON.mockResolvedValue({ shop: true });

        await expect(getModuleStates()).resolves.toEqual({ shop: true });
        expect(moduleConfig.findMany).not.toHaveBeenCalled();
    });

    it("reads the shared cache key", async () => {
        await getModuleStates();
        expect(cacheGetJSON).toHaveBeenCalledWith("blysis:modules:status");
    });

    it("builds the map from the config rows on a miss", async () => {
        moduleConfig.findMany.mockResolvedValue([
            { id: "shop", enabled: true },
            { id: "blog", enabled: false },
        ]);

        await expect(getModuleStates()).resolves.toEqual({ shop: true, blog: false });
    });

    it("caches what it just built, for thirty seconds", async () => {
        moduleConfig.findMany.mockResolvedValue([{ id: "shop", enabled: true }]);

        await getModuleStates();

        expect(cacheSetJSON).toHaveBeenCalledWith(
            "blysis:modules:status", { shop: true }, 30,
        );
    });

    it("selects only the two columns it needs", async () => {
        await getModuleStates();
        expect(moduleConfig.findMany).toHaveBeenCalledWith({
            select: { id: true, enabled: true },
        });
    });

    it("returns an empty map when the database is unreachable", async () => {
        moduleConfig.findMany.mockRejectedValue(new Error("ECONNREFUSED"));

        await expect(getModuleStates()).resolves.toEqual({});
    });

    it("does not cache the empty map from a failed read", async () => {
        moduleConfig.findMany.mockRejectedValue(new Error("ECONNREFUSED"));

        await getModuleStates();

        expect(cacheSetJSON).not.toHaveBeenCalled();
    });

    it("warns about the failure outside production", async () => {
        moduleConfig.findMany.mockRejectedValue(new Error("ECONNREFUSED"));
        await getModuleStates();

        expect(logWarn).toHaveBeenCalled();
    });

    it("stays quiet in production, where this is expected during build", async () => {
        vi.stubEnv("NODE_ENV", "production");
        moduleConfig.findMany.mockRejectedValue(new Error("ECONNREFUSED"));

        await getModuleStates();

        expect(logWarn).not.toHaveBeenCalled();
    });

    it("serves a cached empty map instead of re-querying", async () => {
        // An empty map is only ever cached after a *successful* read, so it
        // means "there are genuinely no rows" - not "the read failed".
        cacheGetJSON.mockResolvedValue({});

        await expect(getModuleStates()).resolves.toEqual({});
        expect(moduleConfig.findMany).not.toHaveBeenCalled();
    });
});

describe("isModuleEnabled", () => {
    it("reports an explicitly enabled module", async () => {
        cacheGetJSON.mockResolvedValue({ shop: true });
        await expect(isModuleEnabled("shop")).resolves.toBe(true);
    });

    it("reports an explicitly disabled module", async () => {
        cacheGetJSON.mockResolvedValue({ shop: false });
        await expect(isModuleEnabled("shop")).resolves.toBe(false);
    });

    it("defaults an unknown module to enabled", async () => {
        cacheGetJSON.mockResolvedValue({ blog: true });

        // A missing row means "no explicit state known", matching what
        // /api/v1/modules already does.
        await expect(isModuleEnabled("shop")).resolves.toBe(true);
    });

    it("defaults to enabled during a database outage", async () => {
        moduleConfig.findMany.mockRejectedValue(new Error("ECONNREFUSED"));

        // Defaulting to false here would 404 every module at once.
        await expect(isModuleEnabled("shop")).resolves.toBe(true);
    });
});

describe("invalidateModuleCache", () => {
    it("drops the shared key so the next read re-queries", async () => {
        await invalidateModuleCache();
        expect(cacheDel).toHaveBeenCalledWith("blysis:modules:status");
    });

    it("drops the config key too", async () => {
        // The two caches are written from the same table. Dropping only the
        // states one left a module reading its old settings for another
        // thirty seconds after an admin saved new ones.
        await invalidateModuleCache();
        expect(cacheDel).toHaveBeenCalledWith("blysis:modules:config");
    });
});

/**
 * A module's stored config travels the same road as its enabled state - own
 * cache key, own soft failure - and none of it was covered: `moduleSettings`
 * arrived with the settings feature and its half of this file was never run.
 */
describe("moduleSettings", () => {
    it("serves a cache hit without touching the database", async () => {
        cacheGetJSON.mockImplementation(async (key: string) =>
            key === "blysis:modules:config" ? { shop: { currency: "TRY" } } : null);

        await expect(moduleSettings("shop")).resolves.toEqual({ stored: { currency: "TRY" } });
        expect(moduleConfig.findMany).not.toHaveBeenCalled();
    });

    it("reads its own cache key, not the states one", async () => {
        await moduleSettings("shop");
        expect(cacheGetJSON).toHaveBeenCalledWith("blysis:modules:config");
    });

    it("builds the bag from the config rows on a miss and caches it", async () => {
        moduleConfig.findMany.mockResolvedValue([
            { id: "shop", config: { currency: "TRY" } },
            { id: "blog", config: { perPage: 10 } },
        ]);

        await expect(moduleSettings("blog")).resolves.toEqual({ stored: { perPage: 10 } });
        expect(moduleConfig.findMany).toHaveBeenCalledWith({ select: { id: true, config: true } });
        expect(cacheSetJSON).toHaveBeenCalledWith(
            "blysis:modules:config",
            { shop: { currency: "TRY" }, blog: { perPage: 10 } },
            30,
        );
    });

    it("hands the resolver nothing for a module that has never been saved", async () => {
        await moduleSettings("shop");

        // Not an error and not an empty object: `undefined` is what tells the
        // resolver to answer with the manifest's own defaults.
        expect(resolveSettings).toHaveBeenCalledWith("shop", undefined);
    });

    it("falls back to the manifest defaults during a database outage", async () => {
        moduleConfig.findMany.mockRejectedValue(new Error("ECONNREFUSED"));

        await expect(moduleSettings("shop")).resolves.toEqual({ stored: undefined });
        expect(logWarn).toHaveBeenCalled();
        // Nothing partial is cached, so the next read tries the database again.
        expect(cacheSetJSON).not.toHaveBeenCalled();
    });

    it("says nothing about that outage in production", async () => {
        vi.stubEnv("NODE_ENV", "production");
        moduleConfig.findMany.mockRejectedValue(new Error("ECONNREFUSED"));

        await expect(moduleSettings("shop")).resolves.toEqual({ stored: undefined });
        expect(logWarn).not.toHaveBeenCalled();
    });
});
