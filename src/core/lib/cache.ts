/**
 * Generic TTL cache helper with pluggable backend.
 *
 * Selection:
 *   - If REDIS_URL is set, we try the Redis backend first and transparently
 *     fall back to the in-memory backend on any error (defensive - a flaky
 *     Redis can never take down a request).
 *   - Otherwise the MemoryCacheBackend is used for the life of the process.
 *
 * Public API:
 *   - getCacheBackend()              - returns the currently preferred backend
 *   - cached(key, ttlMs, loader)     - read-through cache wrapper
 *   - invalidate(keyOrPrefix)        - delete one key; pass "prefix:*" to
 *                                      delete all matching keys
 *
 * Keys use a colon hierarchy (e.g. "trophies:public", "leaderboard:buyers:10").
 * Pass `<prefix>:*` to `invalidate()` to drop every key under that prefix.
 */

import { getRedisClient, isRedisConfigured } from "./redis";
import { errorText, log } from "./logger";

export interface CacheBackend {
    readonly name: string;
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlMs: number): Promise<void>;
    del(key: string): Promise<void>;
    delByPrefix(prefix: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Memory backend - process-local Map. Always available, used as fallback.
// ---------------------------------------------------------------------------

interface MemoryEntry {
    value: unknown;
    expiresAt: number;
}

const memoryStore = new Map<string, MemoryEntry>();

// Clean up expired entries periodically so the store can't grow unbounded.
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memoryStore) {
        if (entry.expiresAt < now) memoryStore.delete(key);
    }
}, 60_000);

export const MemoryCacheBackend: CacheBackend = {
    name: "memory",
    async get<T>(key: string): Promise<T | null> {
        const entry = memoryStore.get(key);
        if (!entry) return null;
        if (entry.expiresAt < Date.now()) {
            memoryStore.delete(key);
            return null;
        }
        return entry.value as T;
    },
    async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
        memoryStore.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    async del(key: string): Promise<void> {
        memoryStore.delete(key);
    },
    async delByPrefix(prefix: string): Promise<void> {
        for (const key of memoryStore.keys()) {
            if (key.startsWith(prefix)) memoryStore.delete(key);
        }
    },
};

// ---------------------------------------------------------------------------
// Redis backend - SCAN + DEL for safe production-grade prefix invalidation.
// ---------------------------------------------------------------------------

const CACHE_PREFIX = "blysis:cache:";
const SCAN_BATCH = 100;

/** Narrower view of the node-redis client the cache backend actually uses. */
interface CacheRedisLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, options?: { EX?: number; PX?: number }): Promise<unknown>;
    del(key: string | string[]): Promise<number>;
    scan(
        cursor: number,
        options?: { MATCH?: string; COUNT?: number },
    ): Promise<{ cursor: number; keys: string[] }>;
}

let redisFallbackWarned = false;

function warnRedisFallbackOnce(err: unknown): void {
    if (redisFallbackWarned) return;
    redisFallbackWarned = true;
    log.warn("[cache] Redis backend unavailable, falling back to memory", { error: errorText(err) });
}

export const RedisCacheBackend: CacheBackend = {
    name: "redis",
    async get<T>(key: string): Promise<T | null> {
        const redis = (await getRedisClient()) as unknown as CacheRedisLike | null;
        if (!redis) return MemoryCacheBackend.get<T>(key);
        try {
            const raw = await redis.get(CACHE_PREFIX + key);
            if (raw === null) return null;
            return JSON.parse(raw) as T;
        } catch (err) {
            warnRedisFallbackOnce(err);
            return MemoryCacheBackend.get<T>(key);
        }
    },
    async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
        const redis = (await getRedisClient()) as unknown as CacheRedisLike | null;
        if (!redis) return MemoryCacheBackend.set<T>(key, value, ttlMs);
        try {
            const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
            await redis.set(CACHE_PREFIX + key, JSON.stringify(value), { EX: ttlSeconds });
        } catch (err) {
            warnRedisFallbackOnce(err);
            return MemoryCacheBackend.set<T>(key, value, ttlMs);
        }
    },
    async del(key: string): Promise<void> {
        const redis = (await getRedisClient()) as unknown as CacheRedisLike | null;
        if (!redis) return MemoryCacheBackend.del(key);
        try {
            await redis.del(CACHE_PREFIX + key);
        } catch (err) {
            warnRedisFallbackOnce(err);
            return MemoryCacheBackend.del(key);
        }
    },
    async delByPrefix(prefix: string): Promise<void> {
        const redis = (await getRedisClient()) as unknown as CacheRedisLike | null;
        if (!redis) return MemoryCacheBackend.delByPrefix(prefix);
        try {
            let cursor = 0;
            const match = `${CACHE_PREFIX}${prefix}*`;
            do {
                const reply = await redis.scan(cursor, { MATCH: match, COUNT: SCAN_BATCH });
                cursor = reply.cursor;
                if (reply.keys.length > 0) {
                    await redis.del(reply.keys);
                }
            } while (cursor !== 0);
        } catch (err) {
            warnRedisFallbackOnce(err);
            return MemoryCacheBackend.delByPrefix(prefix);
        }
    },
};

// ---------------------------------------------------------------------------
// Backend selection + public API
// ---------------------------------------------------------------------------

const preferredBackend: CacheBackend = isRedisConfigured() ? RedisCacheBackend : MemoryCacheBackend;

/**
 * Returns the preferred cache backend for the current process.
 * Callers should normally use {@link cached} / {@link invalidate} instead.
 */
export async function getCacheBackend(): Promise<CacheBackend> {
    return preferredBackend;
}

/**
 * Read-through cache wrapper.
 *
 * Returns the cached value if present; otherwise invokes `loader`, stores
 * the result for `ttlMs`, and returns it.
 *
 * Stampede protection is intentionally *not* implemented - a concurrent
 * miss simply causes a double load. Much simpler, and the workloads this
 * helper targets are cheap read queries where two fetches cost nothing.
 *
 * If the loader throws, the error bubbles up and nothing is cached.
 */
export async function cached<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
): Promise<T> {
    const backend = await getCacheBackend();
    const hit = await backend.get<T>(key);
    if (hit !== null) return hit;

    const fresh = await loader();
    // Never cache `null` or `undefined` - we use `null` as the "miss" sentinel.
    if (fresh !== null && fresh !== undefined) {
        await backend.set<T>(key, fresh, ttlMs);
    }
    return fresh;
}

/**
 * Invalidate a single key or every key starting with a prefix.
 *
 * Pass a trailing `*` (e.g. `"leaderboard:*"`) to trigger a prefix-scan
 * delete. Without the wildcard only the exact key is removed.
 */
export async function invalidate(keyOrPrefix: string): Promise<void> {
    const backend = await getCacheBackend();
    if (keyOrPrefix.endsWith("*")) {
        const prefix = keyOrPrefix.slice(0, -1);
        await backend.delByPrefix(prefix);
        return;
    }
    await backend.del(keyOrPrefix);
}
