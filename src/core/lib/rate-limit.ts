import {
    RATE_LIMIT_AUTH,
    RATE_LIMIT_API,
    RATE_LIMIT_UPLOAD,
} from "./constants";
import { getRedisClient, isRedisConfigured } from "./redis";
import { prisma } from "./db";
import { log } from "./logger";

/**
 * Pluggable rate limiter. Uses Redis when REDIS_URL is set so counts are
 * shared across PM2 workers; otherwise falls back to an in-process Map.
 *
 * Public API:
 *   rateLimit                   - low-level hit against the active backend
 *   rateLimitForRole            - applies per-role multiplier; returns full result
 *   rateLimitForRoleAsync       - boolean-returning variant; transparently
 *                                 falls back to memory on transient Redis failure
 */

export interface RateLimitConfig {
    maxRequests: number;
    windowMs: number;
}

export interface RateLimitResult {
    success: boolean;
    remaining: number;
    resetAt: number;
}

export interface RateLimitBackend {
    readonly name: string;
    hit(identifier: string, config: RateLimitConfig): Promise<RateLimitResult>;
    /**
     * What `hit` would say, without spending anything.
     *
     * For a budget that is only spent by some outcomes: a login counts a wrong
     * password and not a right one, so the check on the way in cannot be the
     * thing that increments. Reading and incrementing separately is not atomic
     * and does not need to be - two callers racing past a ceiling costs one
     * extra guess, and the window is what bounds the attack.
     */
    peek(identifier: string, config: RateLimitConfig): Promise<RateLimitResult>;
}

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

// ===== Memory backend (process-local fallback) =====

const memoryStore = new Map<string, RateLimitEntry>();

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memoryStore) {
        if (entry.resetAt < now) memoryStore.delete(key);
    }
}, 60000);

function memoryHitSync(identifier: string, config: RateLimitConfig): RateLimitResult {
    const now = Date.now();
    const entry = memoryStore.get(identifier);

    if (!entry || entry.resetAt < now) {
        memoryStore.set(identifier, { count: 1, resetAt: now + config.windowMs });
        return { success: true, remaining: config.maxRequests - 1, resetAt: now + config.windowMs };
    }

    entry.count++;

    if (entry.count > config.maxRequests) {
        return { success: false, remaining: 0, resetAt: entry.resetAt };
    }

    return { success: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt };
}

function memoryPeekSync(identifier: string, config: RateLimitConfig): RateLimitResult {
    const now = Date.now();
    const entry = memoryStore.get(identifier);
    if (!entry || entry.resetAt < now) {
        return { success: true, remaining: config.maxRequests, resetAt: now + config.windowMs };
    }
    if (entry.count >= config.maxRequests) {
        return { success: false, remaining: 0, resetAt: entry.resetAt };
    }
    return { success: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt };
}

/** Test seam: the memory backend is process-global and outlives one test. */
export function forgetMemoryRateLimits(): void {
    memoryStore.clear();
}

const MemoryBackend: RateLimitBackend = {
    name: "memory",
    async hit(identifier, config) {
        return memoryHitSync(identifier, config);
    },
    async peek(identifier, config) {
        return memoryPeekSync(identifier, config);
    },
};

// ===== Redis backend (shared across processes) =====
// Any error falls through to the memory backend so a flaky Redis cannot
// take down request handling.

let lastRedisFallbackWarnAt = 0;
function warnRedisFallback(reason: string): void {
    const now = Date.now();
    if (now - lastRedisFallbackWarnAt < 30_000) return;
    lastRedisFallbackWarnAt = now;
    log.error("[rate-limit] Redis unavailable, serving requests with the in-memory fallback. Counts are NOT shared across workers.", { reason });
}

/**
 * One INCR, one PEXPIRE on the first hit of a window, one PTTL to report when
 * it resets - all inside a single server-side script, so a burst of parallel
 * requests is counted once per request. The previous GET-then-SET pair read
 * and wrote the count in two round trips: ten simultaneous requests all read
 * the same number and all wrote it back plus one, recording nine fewer hits
 * than happened. A burst is precisely what a rate limiter is for.
 *
 * PTTL comes back negative when the key exists with no expiry, which only
 * happens if something outside this script wrote it; re-arming the window
 * there keeps a stray key from becoming a permanent block.
 */
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

// What `hit` would answer without spending anything. PTTL is negative for a
// key with no expiry or no key at all; both mean there is nothing to wait for.
const PEEK_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1])) or 0
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then ttl = 0 end
return {count, ttl}
`;

export const RedisBackend: RateLimitBackend = {
    name: "redis",
    async hit(identifier, config) {
        const redis = await getRedisClient();
        if (!redis) {
            warnRedisFallback("client not connected");
            return memoryHitSync(identifier, config);
        }

        try {
            // `rlc:` and not the old `rl:`: those keys hold a JSON blob, and
            // INCR on one errors out. A fresh prefix costs one window of
            // already-counted hits at deploy time instead of a window of
            // every request failing over to memory.
            const key = `rlc:${identifier}`;
            const raw = await redis.eval(HIT_SCRIPT, {
                keys: [key],
                arguments: [String(Math.max(1, Math.floor(config.windowMs)))],
            });

            if (!Array.isArray(raw) || raw.length < 2) {
                throw new Error(`unexpected EVAL reply: ${JSON.stringify(raw)}`);
            }
            const count = Number(raw[0]);
            const ttl = Number(raw[1]);
            if (!Number.isFinite(count) || !Number.isFinite(ttl)) {
                throw new Error(`non-numeric EVAL reply: ${JSON.stringify(raw)}`);
            }

            const resetAt = Date.now() + Math.max(ttl, 0);
            if (count > config.maxRequests) {
                return { success: false, remaining: 0, resetAt };
            }
            return { success: true, remaining: config.maxRequests - count, resetAt };
        } catch (err) {
            warnRedisFallback(err instanceof Error ? err.message : "unknown error");
            return memoryHitSync(identifier, config);
        }
    },

    async peek(identifier, config) {
        const redis = await getRedisClient();
        if (!redis) {
            warnRedisFallback("client not connected");
            return memoryPeekSync(identifier, config);
        }
        try {
            // One round trip, like the hit above, and for the same reason the
            // file already reaches for Lua: two calls to read a counter and
            // its expiry can straddle the window rolling over.
            const raw = await redis.eval(PEEK_SCRIPT, { keys: [`rlc:${identifier}`] });
            if (!Array.isArray(raw) || raw.length < 2) {
                throw new Error("unexpected EVAL reply");
            }
            const count = Number(raw[0]);
            const ttl = Number(raw[1]);
            if (!Number.isFinite(count) || !Number.isFinite(ttl)) {
                throw new Error("non-numeric EVAL reply");
            }
            const resetAt = Date.now() + Math.max(ttl, 0);
            if (count >= config.maxRequests) {
                return { success: false, remaining: 0, resetAt };
            }
            return { success: true, remaining: config.maxRequests - count, resetAt };
        } catch (err) {
            warnRedisFallback(err instanceof Error ? err.message : "unknown error");
            return memoryPeekSync(identifier, config);
        }
    },
};

/**
 * Pick the backend on first use (not at module load) so `next build` can
 * compile when REDIS_URL is only present at runtime.
 *
 * Production requires Redis, and denies every rate-limited request until it
 * has it - including /api/health, so the site reads as down rather than as
 * quietly unprotected. Two reasons, both still true now that a single app
 * process is the only supported topology:
 *
 *  - The memory backend is process-local, so it resets on every restart. This
 *    platform restarts itself after a module install, which hands an attacker
 *    a fresh quota on demand.
 *  - A second process during a deploy window, or an operator who ignores the
 *    single-process rule, silently halves every limit.
 *
 * ALLOW_MEMORY_RATE_LIMIT=1 opts out, for a single-process deployment whose
 * operator has read the above and accepts it.
 */
let cachedBackend: RateLimitBackend | null = null;
let prodMisconfigLoggedAt = 0;

function getActiveBackend(): RateLimitBackend {
    if (cachedBackend) return cachedBackend;

    if (isRedisConfigured()) {
        cachedBackend = RedisBackend;
        return cachedBackend;
    }

    const isProd = process.env.NODE_ENV === "production";
    const override = process.env.ALLOW_MEMORY_RATE_LIMIT === "1";
    if (isProd && !override) {
        const now = Date.now();
        if (now - prodMisconfigLoggedAt > 60_000) {
            prodMisconfigLoggedAt = now;
            log.error(
                "[rate-limit] REDIS_URL is required in production. " +
                "The in-memory backend resets on every restart - including the restart a " +
                "module install performs - so limits are bypassable on demand. " +
                "Set REDIS_URL, or ALLOW_MEMORY_RATE_LIMIT=1 to accept that. " +
                "Every rate-limited request, /api/health included, is denied until then.",
            );
        }
        // Not cached: re-evaluate on every call so a freshly-set REDIS_URL
        // is picked up without a restart.
        return DenyAllBackend;
    }

    cachedBackend = MemoryBackend;
    return cachedBackend;
}

const DenyAllBackend: RateLimitBackend = {
    name: "deny-all",
    async hit(_identifier, _config) {
        return { success: false, remaining: 0, resetAt: Date.now() + 60_000 };
    },
    // Denies too. A production install with no Redis is already refusing
    // every rate-limited request, and letting a peek answer "there is room"
    // would open the one path that asks before it spends.
    async peek(_identifier, _config) {
        return { success: false, remaining: 0, resetAt: Date.now() + 60_000 };
    },
};

/** True when REDIS_URL is set and the client is currently reachable. */
export async function isRedisReady(): Promise<boolean> {
    if (!isRedisConfigured()) return false;
    try {
        const redis = await getRedisClient();
        if (!redis) return false;
        await redis.ping();
        return true;
    } catch {
        return false;
    }
}

export async function rateLimit(
    identifier: string,
    config: RateLimitConfig = { maxRequests: 60, windowMs: 60000 }
): Promise<RateLimitResult> {
    return getActiveBackend().hit(identifier, config);
}

/**
 * Whether `identifier` still has room, without taking any.
 *
 * For a budget spent by one outcome and checked on every attempt. See
 * `RateLimitBackend.peek`.
 */
export async function rateLimitPeek(
    identifier: string,
    config: RateLimitConfig = { maxRequests: 60, windowMs: 60000 }
): Promise<RateLimitResult> {
    return getActiveBackend().peek(identifier, config);
}

// Comma-separated direct-peer IPs that may set forwarded headers.
// Without this set, anything goes - set TRUSTED_PROXY_IPS in production.
const TRUSTED_PROXY_IPS: Set<string> | null = process.env.TRUSTED_PROXY_IPS
    ? new Set(process.env.TRUSTED_PROXY_IPS.split(",").map(ip => ip.trim()))
    : null;

/**
 * Say so at boot when nothing about the caller's address can be verified.
 *
 * With no trusted proxy declared, `x-forwarded-for` and `x-real-ip` arrive
 * exactly as the caller wrote them, so every rate limit and every IP block is
 * keyed on an address the caller picks: rotating one header buys a fresh
 * budget, and a blocked address is evaded by typing a different one. That is
 * the documented default, because without a proxy the application has no
 * other way to tell two anonymous callers apart, but an operator who has put
 * a proxy in front and not declared it has no way to notice on their own.
 *
 * Called once per server instance from `instrumentation.ts`.
 */
export function warnIfProxyTrustUnconfigured(): void {
    if (TRUSTED_PROXY_IPS) return;
    log.warn(
        "TRUSTED_PROXY_IPS is not set: forwarded headers arrive unverified, " +
        "so rate limits and IP blocks are keyed on an address the caller can choose. " +
        "Set it to your reverse proxy's address.",
    );
}

/**
 * Which address in a forwarded chain is the caller.
 *
 * `x-forwarded-for` is a list, and a proxy appends to its right: nginx's
 * `$proxy_add_x_forwarded_for` and Caddy both add the peer they saw to the
 * end. Everything to the left of that is whatever the client chose to send.
 * Reading the leftmost entry therefore reads the attacker's own text, which
 * is the classic way a forwarded header gets trusted by mistake.
 *
 * Walking from the right and stepping over addresses that are themselves
 * trusted proxies gives the first address no trusted hop vouched for, which
 * is the caller. It also makes `TRUSTED_PROXY_IPS` mean what its name says
 * for a chain of more than one hop, a CDN in front of nginx for instance.
 *
 * Exported for the tests: the env-derived set is read once at module load, so
 * the decision has to be reachable without it.
 */
export function resolveClientIp(
    realIp: string | null,
    forwardedFor: string | null,
    trusted: Set<string> | null,
): string {
    const chain = (forwardedFor ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

    if (trusted) {
        // Without a proxy in front, `x-real-ip` is whatever the caller typed.
        // Behind one, every configuration this project ships overwrites it
        // with the peer, so it is the only address here worth starting from.
        const peer = realIp || "unknown";
        if (!trusted.has(peer)) return peer;
        for (let i = chain.length - 1; i >= 0; i--) {
            if (!trusted.has(chain[i])) return chain[i];
        }
        return peer;
    }

    // Nothing is verifiable without a trusted list, and this is the documented
    // default: see TRUSTED_PROXY_IPS in .env.example and the deployment guide.
    // The rightmost entry is still the better guess, because an operator who
    // has a proxy but has not declared it gets the address it appended rather
    // than the one the caller prepended.
    return realIp || chain[chain.length - 1] || "unknown";
}

/**
 * The part of `Headers` this needs. Widened from `Headers` so that
 * `next/headers`, whose `ReadonlyHeaders` is a separate type, can be handed
 * here directly rather than each caller re-reading the raw headers itself.
 */
export interface HeaderReader {
    get(name: string): string | null;
}

/**
 * Resolve the real client IP from request headers.
 *
 * When TRUSTED_PROXY_IPS is set, `x-forwarded-for` is only honored if the
 * direct peer (x-real-ip) is in the trusted list - this blocks header
 * injection spoofing from unauthorised origins.
 */
export function getClientIP(headers: HeaderReader): string {
    return resolveClientIp(
        headers.get("x-real-ip")?.trim() || null,
        headers.get("x-forwarded-for") || null,
        TRUSTED_PROXY_IPS,
    );
}

export const rateLimits = {
    auth: RATE_LIMIT_AUTH,
    api: RATE_LIMIT_API,
    upload: RATE_LIMIT_UPLOAD,
};

// ===== Per-role multipliers =====
// Stored in Setting "rate_limit_role_multipliers" as { role: number }.
//   0       - unlimited (skip rate limit entirely)
//   1       - base limit (default when no entry exists)
//   >1      - multiply base limit (e.g. 5 = 5x more requests allowed)
//   0..100  - accepted range, validated on write
// Cached in-process for 60s; call invalidateRoleMultiplierCache after edits.

export const ROLE_MULTIPLIER_SETTING_KEY = "rate_limit_role_multipliers";
const ROLE_MULTIPLIER_CACHE_TTL_MS = 60_000;

let roleMultiplierCache: Map<string, number> | null = null;
let roleMultiplierCacheExpiresAt = 0;

/** Drop the cache so the next request reloads multipliers from DB. */
export function invalidateRoleMultiplierCache(): void {
    roleMultiplierCache = null;
    roleMultiplierCacheExpiresAt = 0;
}

/** Returns an empty Map on error so callers fall back to multiplier=1. */
export async function getRoleMultipliers(): Promise<Map<string, number>> {
    const now = Date.now();
    if (roleMultiplierCache && roleMultiplierCacheExpiresAt > now) {
        return roleMultiplierCache;
    }

    const fresh = new Map<string, number>();
    try {
        const row = await prisma.setting.findUnique({
            where: { key: ROLE_MULTIPLIER_SETTING_KEY },
        });
        if (row && row.value && typeof row.value === "object" && !Array.isArray(row.value)) {
            for (const [role, raw] of Object.entries(row.value as Record<string, unknown>)) {
                const num = typeof raw === "number" ? raw : Number(raw);
                if (Number.isFinite(num) && num >= 0 && num <= 100) {
                    fresh.set(role, num);
                }
            }
        }
    } catch {
        // Silent fail; callers treat a missing entry as multiplier=1.
    }

    roleMultiplierCache = fresh;
    roleMultiplierCacheExpiresAt = now + ROLE_MULTIPLIER_CACHE_TTL_MS;
    return fresh;
}

async function resolveRoleMultiplier(role?: string | null): Promise<number> {
    if (!role) return 1;
    try {
        const map = await getRoleMultipliers();
        const entry = map.get(role);
        return typeof entry === "number" ? entry : 1;
    } catch {
        return 1;
    }
}

/** Returns null when the multiplier is 0 (unlimited) so callers short-circuit. */
function applyMultiplier(
    baseConfig: RateLimitConfig,
    multiplier: number
): RateLimitConfig | null {
    if (multiplier === 0) return null;
    return {
        maxRequests: Math.max(1, Math.floor(baseConfig.maxRequests * multiplier)),
        windowMs: baseConfig.windowMs,
    };
}

/**
 * Role-aware wrapper. Multiplier 0 returns unlimited; otherwise scales
 * maxRequests. DB errors fall back to multiplier=1 (base limit).
 */
export async function rateLimitForRole(
    identifier: string,
    baseConfig: RateLimitConfig,
    role?: string | null
): Promise<RateLimitResult> {
    const multiplier = await resolveRoleMultiplier(role);
    const effective = applyMultiplier(baseConfig, multiplier);
    if (effective === null) {
        return { success: true, remaining: Number.POSITIVE_INFINITY, resetAt: 0 };
    }
    return rateLimit(identifier, effective);
}

/**
 * Boolean-returning rate limiter, for the callers that only need the
 * allow/deny bit. Every rate-limited route on the site goes through here.
 *
 * It used to PING Redis before every hit and pick a backend from the answer,
 * on the reasoning that a long-running process should recover from a
 * transient outage without a restart. It does recover - but not because of
 * the ping. `RedisBackend.hit` fetches the client and catches its own errors
 * on every call, falling through to the memory backend and logging why, which
 * is exactly what the probe was arranging by hand. `rateLimit` has always
 * relied on that and behaves identically.
 *
 * What the probe did add was a second round trip to Redis on the busiest path
 * in the application: a cart update, a forum like, an activity feed poll all
 * paid a PING before their INCR. This is one round trip now, and one code
 * path shared with the other two entry points instead of a second one free to
 * drift from them.
 */
export async function rateLimitForRoleAsync(
    identifier: string,
    baseConfig: RateLimitConfig,
    role?: string | null
): Promise<boolean> {
    const result = await rateLimitForRole(identifier, baseConfig, role);
    return result.success;
}
