import prisma from "@/core/lib/db";
import { cleanTranslatableText, type TranslatableText } from "@/core/lib/i18n/translatable-text";

/**
 * Maintenance mode configuration, backed by the Setting table under key
 * `maintenance_mode`. Values are cached in memory for 5 seconds via a
 * globalThis-backed store so the proxy and API route chunks share state.
 */

/** The longest message, in any one language. */
export const MAINTENANCE_MESSAGE_MAX = 2000;

export interface MaintenanceConfig {
    enabled: boolean;
    /** The operator's own words, which they may write per language. */
    message?: TranslatableText;
    allowedRoles?: string[];
}

const DEFAULT_CONFIG: MaintenanceConfig = {
    enabled: false,
    message: "",
    allowedRoles: ["admin"],
};

const SETTING_KEY = "maintenance_mode";
const CACHE_TTL_MS = 5_000; // 5 seconds - short enough to feel instant after admin save

// Use globalThis so proxy.ts and API route chunks (separate Turbopack bundles)
// share the same in-memory cache object. Without this, setMaintenanceConfig()
// in the API route updates a *different* `cached` variable than the one
// getMaintenanceConfig() reads inside the proxy, causing a stale-cache window
// where the proxy keeps serving old state for up to CACHE_TTL_MS.
const GLOBAL_KEY = "__blysis_maintenance_cache__" as const;

interface MaintenanceCache {
    config: MaintenanceConfig | null;
    at: number;
}

function getGlobalCache(): MaintenanceCache {
    const g = globalThis as unknown as Record<string, MaintenanceCache | undefined>;
    if (!g[GLOBAL_KEY]) {
        g[GLOBAL_KEY] = { config: null, at: 0 };
    }
    return g[GLOBAL_KEY]!;
}

// Convenience aliases so the rest of the file stays readable.
function getCached(): MaintenanceConfig | null { return getGlobalCache().config; }
function getCachedAt(): number { return getGlobalCache().at; }
function setCache(config: MaintenanceConfig | null, at: number): void {
    const c = getGlobalCache();
    c.config = config;
    c.at = at;
}

function normalize(raw: unknown): MaintenanceConfig {
    if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG };
    const obj = raw as Record<string, unknown>;
    const allowed = Array.isArray(obj.allowedRoles)
        ? (obj.allowedRoles as unknown[]).filter((r): r is string => typeof r === "string")
        : DEFAULT_CONFIG.allowedRoles;
    return {
        enabled: Boolean(obj.enabled),
        message: cleanTranslatableText(obj.message, MAINTENANCE_MESSAGE_MAX) ?? "",
        allowedRoles: allowed,
    };
}

export async function getMaintenanceConfig(): Promise<MaintenanceConfig> {
    const now = Date.now();
    const cached = getCached();
    if (cached && now - getCachedAt() < CACHE_TTL_MS) return cached;

    try {
        const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
        const config = row ? normalize(row.value) : { ...DEFAULT_CONFIG };
        setCache(config, now);
        return config;
    } catch {
        // On DB error, fail-safe: return disabled so site stays up.
        return { ...DEFAULT_CONFIG };
    }
}

export async function setMaintenanceConfig(config: MaintenanceConfig): Promise<void> {
    const normalized = normalize(config);
    await prisma.setting.upsert({
        where: { key: SETTING_KEY },
        update: { value: normalized as unknown as object },
        create: { key: SETTING_KEY, value: normalized as unknown as object, module: "core" },
    });
    setCache(normalized, Date.now());
}

export function invalidateMaintenanceCache(): void {
    setCache(null, 0);
}
