/**
 * Module config cache - uses Redis when available, in-memory fallback.
 * Called from API routes and server components (NOT proxy/middleware).
 */

import { prisma } from "./db";
import { cacheGetJSON, cacheSetJSON, cacheDel } from "./redis";
import { errorText, log } from "./logger";
import { resolveSettings, type SettingValue } from "./module-settings";

const CACHE_KEY = "blysis:modules:status";
const CONFIG_CACHE_KEY = "blysis:modules:config";
const CACHE_TTL = 30; // seconds

/** Get all module enabled/disabled states (cached) */
export async function getModuleStates(): Promise<Record<string, boolean>> {
    const cached = await cacheGetJSON<Record<string, boolean>>(CACHE_KEY);
    if (cached) return cached;

    // Cache miss - query DB. Must fail soft: this helper is called from
    // the proxy middleware on every request, from module-provider during
    // SSR, and (crucially) during `next build`'s static-collection phase
    // where DATABASE_URL may not be reachable at all. Treat an unavailable
    // DB as "no explicit states known" - consumers default to enabled.
    let configs: Array<{ id: string; enabled: boolean }> = [];
    try {
        configs = await prisma.moduleConfig.findMany({ select: { id: true, enabled: true } });
    } catch (err) {
        if (process.env.NODE_ENV !== "production") {
            log.warn("[module-cache] moduleConfig.findMany failed, returning empty", { error: errorText(err) });
        }
        return {};
    }

    const states: Record<string, boolean> = {};
    for (const c of configs) states[c.id] = c.enabled;
    await cacheSetJSON(CACHE_KEY, states, CACHE_TTL);
    return states;
}

/**
 * Whether one module is currently enabled.
 *
 * This is what a module should call to gate its own endpoints. The alternative
 * - `moduleSystem.isEnabled()` - reports false until something has called
 * `moduleSystem.initialize()`, which pushed modules into re-initialising a
 * shared singleton on every request just to answer this question.
 *
 * An unknown id resolves to `true`, matching the convention `getModuleStates`
 * documents and `/api/v1/modules` already applies: a missing row means "no
 * explicit state known", and during a DB outage that returns an empty map.
 * Defaulting to false there would 404 every module the moment the database
 * blinked.
 */
export async function isModuleEnabled(id: string): Promise<boolean> {
    const states = await getModuleStates();
    return states[id] ?? true;
}

/** Invalidate module states cache (call after enable/disable/install/uninstall) */
export async function invalidateModuleCache(): Promise<void> {
    await cacheDel(CACHE_KEY);
    await cacheDel(CONFIG_CACHE_KEY);
}

/**
 * Every module's stored config bag, cached alongside the enabled states.
 *
 * Kept separate from `getModuleStates` because that map is read by the proxy
 * middleware on every request and only needs a boolean per module; config is
 * read by the handful of modules that declare settings.
 */
async function getModuleConfigs(): Promise<Record<string, unknown>> {
    const cached = await cacheGetJSON<Record<string, unknown>>(CONFIG_CACHE_KEY);
    if (cached) return cached;

    let configs: Array<{ id: string; config: unknown }> = [];
    try {
        configs = await prisma.moduleConfig.findMany({ select: { id: true, config: true } });
    } catch (err) {
        // Same contract as getModuleStates: an unreachable database means "no
        // stored config known", and every caller falls back to the manifest
        // defaults rather than failing the request.
        if (process.env.NODE_ENV !== "production") {
            log.warn("[module-cache] moduleConfig.findMany failed, returning empty", { error: errorText(err) });
        }
        return {};
    }

    const out: Record<string, unknown> = {};
    for (const c of configs) out[c.id] = c.config;
    await cacheSetJSON(CONFIG_CACHE_KEY, out, CACHE_TTL);
    return out;
}

/**
 * A module's own settings: its manifest defaults overlaid with whatever an
 * admin has saved, each value checked and clamped against its declaration.
 *
 * This is what a module calls to read its own configuration. It never throws
 * and never returns a key the manifest does not declare, so a caller can index
 * the result directly.
 */
export async function moduleSettings<T extends Record<string, SettingValue>>(
    moduleId: string,
): Promise<T> {
    const configs = await getModuleConfigs();
    return resolveSettings(moduleId, configs[moduleId]) as T;
}
