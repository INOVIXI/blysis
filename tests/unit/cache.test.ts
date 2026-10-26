import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * cache.ts is the read-through layer in front of the expensive queries
 * (leaderboards, trophies, public listings). Two behaviours here are
 * load-bearing and were untested: `null` doubles as the miss sentinel, so
 * caching a `null` loader result would poison the key forever; and every
 * Redis path is supposed to fall back to memory rather than throw, so a
 * flaky Redis degrades performance instead of returning 500s.
 */

const { getRedisClient, isRedisConfigured } = vi.hoisted(() => ({
    getRedisClient: vi.fn(),
    isRedisConfigured: vi.fn(() => false),
}));

vi.mock("@/core/lib/redis", () => ({ getRedisClient, isRedisConfigured }));

const { logWarn } = vi.hoisted(() => ({ logWarn: vi.fn() }));
vi.mock("@/core/lib/logger", () => ({
    errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    log: { debug: vi.fn(), info: vi.fn(), warn: logWarn, error: vi.fn() },
}));

type CacheModule = typeof import("@/core/lib/cache");

interface FakeRedis {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    scan: ReturnType<typeof vi.fn>;
}

function fakeRedis(over: Partial<FakeRedis> = {}): FakeRedis {
    return {
        get: vi.fn(async () => null),
        set: vi.fn(async () => "OK"),
        del: vi.fn(async () => 1),
        scan: vi.fn(async () => ({ cursor: 0, keys: [] })),
        ...over,
    } as FakeRedis;
}

beforeEach(() => {
    getRedisClient.mockReset().mockResolvedValue(null);
    isRedisConfigured.mockReset().mockReturnValue(false);
    logWarn.mockReset();
    // The module arms a 60s sweep at import; fake timers keep it contained.
    vi.useFakeTimers();
    vi.resetModules();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/** Fresh module instance - the memory Map and the warn latch are module scope. */
async function load(redisConfigured = false): Promise<CacheModule> {
    isRedisConfigured.mockReturnValue(redisConfigured);
    vi.resetModules();
    return (await import("@/core/lib/cache")) as CacheModule;
}

// ===========================================================================

describe("MemoryCacheBackend", () => {
    it("identifies itself", async () => {
        const { MemoryCacheBackend } = await load();
        expect(MemoryCacheBackend.name).toBe("memory");
    });

    it("returns null for an unknown key", async () => {
        const { MemoryCacheBackend } = await load();
        await expect(MemoryCacheBackend.get("nope")).resolves.toBeNull();
    });

    it("round-trips a value", async () => {
        const { MemoryCacheBackend } = await load();
        await MemoryCacheBackend.set("k", { a: 1 }, 1000);

        await expect(MemoryCacheBackend.get("k")).resolves.toEqual({ a: 1 });
    });

    it("stores by reference rather than serialising", async () => {
        const { MemoryCacheBackend } = await load();
        const value = { a: 1 };
        await MemoryCacheBackend.set("k", value, 1000);

        await expect(MemoryCacheBackend.get("k")).resolves.toBe(value);
    });

    it("expires an entry once the ttl has elapsed", async () => {
        const { MemoryCacheBackend } = await load();
        await MemoryCacheBackend.set("k", "v", 1000);

        vi.setSystemTime(Date.now() + 1001);

        await expect(MemoryCacheBackend.get("k")).resolves.toBeNull();
    });

    it("still serves an entry at the moment it expires", async () => {
        const { MemoryCacheBackend } = await load();
        await MemoryCacheBackend.set("k", "v", 1000);

        vi.setSystemTime(Date.now() + 1000);

        await expect(MemoryCacheBackend.get("k")).resolves.toBe("v");
    });

    it("deletes a single key", async () => {
        const { MemoryCacheBackend } = await load();
        await MemoryCacheBackend.set("k", "v", 1000);

        await MemoryCacheBackend.del("k");

        await expect(MemoryCacheBackend.get("k")).resolves.toBeNull();
    });

    it("deletes every key under a prefix and nothing else", async () => {
        const { MemoryCacheBackend } = await load();
        await MemoryCacheBackend.set("board:a", 1, 1000);
        await MemoryCacheBackend.set("board:b", 2, 1000);
        await MemoryCacheBackend.set("other", 3, 1000);

        await MemoryCacheBackend.delByPrefix("board:");

        await expect(MemoryCacheBackend.get("board:a")).resolves.toBeNull();
        await expect(MemoryCacheBackend.get("board:b")).resolves.toBeNull();
        await expect(MemoryCacheBackend.get("other")).resolves.toBe(3);
    });

    it("sweeps expired entries on the cleanup interval", async () => {
        const { MemoryCacheBackend } = await load();
        await MemoryCacheBackend.set("k", "v", 1000);

        vi.setSystemTime(Date.now() + 60_001);
        await vi.advanceTimersByTimeAsync(60_000);

        await expect(MemoryCacheBackend.get("k")).resolves.toBeNull();
    });
});

describe("RedisCacheBackend", () => {
    it("identifies itself", async () => {
        const { RedisCacheBackend } = await load(true);
        expect(RedisCacheBackend.name).toBe("redis");
    });

    it("namespaces keys so the cache cannot collide with other data", async () => {
        const redis = fakeRedis();
        getRedisClient.mockResolvedValue(redis);
        const { RedisCacheBackend } = await load(true);

        await RedisCacheBackend.get("board:a");

        expect(redis.get).toHaveBeenCalledWith("blysis:cache:board:a");
    });

    it("parses the stored json", async () => {
        getRedisClient.mockResolvedValue(fakeRedis({
            get: vi.fn(async () => '{"a":1}'),
        }));
        const { RedisCacheBackend } = await load(true);

        await expect(RedisCacheBackend.get("k")).resolves.toEqual({ a: 1 });
    });

    it("reports a miss as null without consulting memory", async () => {
        getRedisClient.mockResolvedValue(fakeRedis());
        const { RedisCacheBackend } = await load(true);
        await RedisCacheBackend.set("k", "memory-value", 1000);

        // Redis said "not here", which is authoritative.
        await expect(RedisCacheBackend.get("k")).resolves.toBeNull();
    });

    it("serialises on write with the ttl in whole seconds", async () => {
        const redis = fakeRedis();
        getRedisClient.mockResolvedValue(redis);
        const { RedisCacheBackend } = await load(true);

        await RedisCacheBackend.set("k", { a: 1 }, 2500);

        expect(redis.set).toHaveBeenCalledWith("blysis:cache:k", '{"a":1}', { EX: 3 });
    });

    it("never writes a sub-second ttl that would expire instantly", async () => {
        const redis = fakeRedis();
        getRedisClient.mockResolvedValue(redis);
        const { RedisCacheBackend } = await load(true);

        await RedisCacheBackend.set("k", "v", 0);

        expect(redis.set.mock.calls[0]![2]).toEqual({ EX: 1 });
    });

    it("deletes the namespaced key", async () => {
        const redis = fakeRedis();
        getRedisClient.mockResolvedValue(redis);
        const { RedisCacheBackend } = await load(true);

        await RedisCacheBackend.del("k");

        expect(redis.del).toHaveBeenCalledWith("blysis:cache:k");
    });

    it("scans in batches rather than issuing KEYS", async () => {
        const redis = fakeRedis({
            scan: vi.fn(async () => ({ cursor: 0, keys: ["blysis:cache:board:a"] })),
        });
        getRedisClient.mockResolvedValue(redis);
        const { RedisCacheBackend } = await load(true);

        await RedisCacheBackend.delByPrefix("board:");

        expect(redis.scan).toHaveBeenCalledWith(0, { MATCH: "blysis:cache:board:*", COUNT: 100 });
        expect(redis.del).toHaveBeenCalledWith(["blysis:cache:board:a"]);
    });

    it("follows the scan cursor to the end", async () => {
        const scan = vi.fn()
            .mockResolvedValueOnce({ cursor: 17, keys: ["blysis:cache:board:a"] })
            .mockResolvedValueOnce({ cursor: 0, keys: ["blysis:cache:board:b"] });
        const redis = fakeRedis({ scan });
        getRedisClient.mockResolvedValue(redis);
        const { RedisCacheBackend } = await load(true);

        await RedisCacheBackend.delByPrefix("board:");

        expect(scan).toHaveBeenCalledTimes(2);
        expect(scan.mock.calls[1]![0]).toBe(17);
        expect(redis.del).toHaveBeenCalledTimes(2);
    });

    it("issues no delete for an empty scan page", async () => {
        const redis = fakeRedis();
        getRedisClient.mockResolvedValue(redis);
        const { RedisCacheBackend } = await load(true);

        await RedisCacheBackend.delByPrefix("board:");

        expect(redis.del).not.toHaveBeenCalled();
    });
});

describe("Redis degradation", () => {
    it("uses memory when no client can be obtained", async () => {
        getRedisClient.mockResolvedValue(null);
        const { RedisCacheBackend } = await load(true);

        await RedisCacheBackend.set("k", "v", 1000);

        await expect(RedisCacheBackend.get("k")).resolves.toBe("v");
    });

    it("falls back to memory when a read throws", async () => {
        getRedisClient.mockResolvedValue(fakeRedis({
            get: vi.fn(async () => { throw new Error("connection lost"); }),
        }));
        const { RedisCacheBackend, MemoryCacheBackend } = await load(true);
        await MemoryCacheBackend.set("k", "from-memory", 1000);

        await expect(RedisCacheBackend.get("k")).resolves.toBe("from-memory");
    });

    it("falls back to memory when a write throws", async () => {
        getRedisClient.mockResolvedValue(fakeRedis({
            set: vi.fn(async () => { throw new Error("connection lost"); }),
        }));
        const { RedisCacheBackend, MemoryCacheBackend } = await load(true);

        await RedisCacheBackend.set("k", "v", 1000);

        await expect(MemoryCacheBackend.get("k")).resolves.toBe("v");
    });

    it("falls back to memory when a delete throws", async () => {
        getRedisClient.mockResolvedValue(fakeRedis({
            del: vi.fn(async () => { throw new Error("connection lost"); }),
        }));
        const { RedisCacheBackend, MemoryCacheBackend } = await load(true);
        await MemoryCacheBackend.set("k", "v", 1000);

        await RedisCacheBackend.del("k");

        await expect(MemoryCacheBackend.get("k")).resolves.toBeNull();
    });

    it("falls back to memory when a prefix scan throws", async () => {
        getRedisClient.mockResolvedValue(fakeRedis({
            scan: vi.fn(async () => { throw new Error("connection lost"); }),
        }));
        const { RedisCacheBackend, MemoryCacheBackend } = await load(true);
        await MemoryCacheBackend.set("board:a", 1, 1000);

        await RedisCacheBackend.delByPrefix("board:");

        await expect(MemoryCacheBackend.get("board:a")).resolves.toBeNull();
    });

    it("warns once, not once per request, while Redis is down", async () => {
        getRedisClient.mockResolvedValue(fakeRedis({
            get: vi.fn(async () => { throw new Error("connection lost"); }),
        }));
        const { RedisCacheBackend } = await load(true);

        await RedisCacheBackend.get("a");
        await RedisCacheBackend.get("b");
        await RedisCacheBackend.get("c");

        expect(logWarn).toHaveBeenCalledTimes(1);
        expect(logWarn.mock.calls[0]![1]).toEqual({ error: "connection lost" });
    });

    it("stringifies a non-Error failure in the warning", async () => {
        getRedisClient.mockResolvedValue(fakeRedis({
            get: vi.fn(async () => { throw "socket hang up"; }),
        }));
        const { RedisCacheBackend } = await load(true);

        await RedisCacheBackend.get("a");

        expect(logWarn.mock.calls[0]![1]).toEqual({ error: "socket hang up" });
    });
});

describe("getCacheBackend", () => {
    it("picks memory when Redis is not configured", async () => {
        const { getCacheBackend } = await load(false);
        expect((await getCacheBackend()).name).toBe("memory");
    });

    it("picks Redis when it is configured", async () => {
        const { getCacheBackend } = await load(true);
        expect((await getCacheBackend()).name).toBe("redis");
    });

    it("is decided once at import, not per call", async () => {
        const { getCacheBackend } = await load(false);
        isRedisConfigured.mockReturnValue(true);

        expect((await getCacheBackend()).name).toBe("memory");
    });
});

describe("cached", () => {
    it("invokes the loader on a miss and returns its value", async () => {
        const { cached } = await load();
        const loader = vi.fn(async () => ({ a: 1 }));

        await expect(cached("k", 1000, loader)).resolves.toEqual({ a: 1 });
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it("serves the second call from cache", async () => {
        const { cached } = await load();
        const loader = vi.fn(async () => ({ a: 1 }));

        await cached("k", 1000, loader);
        await expect(cached("k", 1000, loader)).resolves.toEqual({ a: 1 });

        expect(loader).toHaveBeenCalledTimes(1);
    });

    it("reloads once the ttl has passed", async () => {
        const { cached } = await load();
        const loader = vi.fn(async () => 1);

        await cached("k", 1000, loader);
        vi.setSystemTime(Date.now() + 1001);
        await cached("k", 1000, loader);

        expect(loader).toHaveBeenCalledTimes(2);
    });

    it("never caches null, which is the miss sentinel", async () => {
        const { cached } = await load();
        const loader = vi.fn(async () => null);

        await cached("k", 1000, loader);
        await cached("k", 1000, loader);

        // Caching it would make the key permanently indistinguishable from
        // a miss and re-run the loader forever anyway.
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it("never caches undefined", async () => {
        const { cached } = await load();
        const loader = vi.fn(async () => undefined);

        await cached("k", 1000, loader);
        await cached("k", 1000, loader);

        expect(loader).toHaveBeenCalledTimes(2);
    });

    it("caches falsy values that are not the sentinel", async () => {
        const { cached } = await load();
        const loader = vi.fn(async () => 0);

        await cached("k", 1000, loader);
        await expect(cached("k", 1000, loader)).resolves.toBe(0);

        expect(loader).toHaveBeenCalledTimes(1);
    });

    it("lets a loader error bubble up and caches nothing", async () => {
        const { cached } = await load();
        const loader = vi.fn(async () => { throw new Error("query failed"); });

        await expect(cached("k", 1000, loader)).rejects.toThrow("query failed");

        const ok = vi.fn(async () => "recovered");
        await expect(cached("k", 1000, ok)).resolves.toBe("recovered");
    });

    it("keeps separate keys separate", async () => {
        const { cached } = await load();
        await cached("a", 1000, async () => 1);

        await expect(cached("b", 1000, async () => 2)).resolves.toBe(2);
    });
});

describe("invalidate", () => {
    it("drops a single key", async () => {
        const { cached, invalidate } = await load();
        const loader = vi.fn(async () => 1);
        await cached("k", 1000, loader);

        await invalidate("k");
        await cached("k", 1000, loader);

        expect(loader).toHaveBeenCalledTimes(2);
    });

    it("treats a trailing star as a prefix wipe", async () => {
        const { cached, invalidate } = await load();
        await cached("board:a", 1000, async () => 1);
        await cached("board:b", 1000, async () => 2);
        await cached("other", 1000, async () => 3);

        await invalidate("board:*");

        const reload = vi.fn(async () => 99);
        await expect(cached("board:a", 1000, reload)).resolves.toBe(99);
        await expect(cached("other", 1000, reload)).resolves.toBe(3);
    });

    it("strips only the star, keeping the rest of the prefix", async () => {
        const redis = fakeRedis();
        getRedisClient.mockResolvedValue(redis);
        const { invalidate } = await load(true);

        await invalidate("board:*");

        expect(redis.scan.mock.calls[0]![1]).toEqual({
            MATCH: "blysis:cache:board:*", COUNT: 100,
        });
    });

    it("does not treat a mid-key star as a wildcard", async () => {
        const redis = fakeRedis();
        getRedisClient.mockResolvedValue(redis);
        const { invalidate } = await load(true);

        await invalidate("bo*ard");

        expect(redis.del).toHaveBeenCalledWith("blysis:cache:bo*ard");
        expect(redis.scan).not.toHaveBeenCalled();
    });
});
