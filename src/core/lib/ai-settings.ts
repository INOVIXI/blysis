/**
 * The operator's AI settings: their keys, defaults and bounds, and the one
 * reading of a saved value.
 *
 * Import-free, so the AI screen can show the same bounds the server enforces
 * without a client bundle pulling in the registry or the database.
 */

export const AI_SETTING_KEYS = {
    timeoutSeconds: "ai_timeout_seconds",
    dailyTokenLimit: "ai_daily_token_limit",
    moduleTokenLimits: "ai_module_token_limits",
    requestsPerMinute: "ai_requests_per_minute",
    retentionDays: "ai_usage_retention_days",
} as const;

/** Zero means no limit for the two that may be switched off. */
export const AI_SETTING_BOUNDS = {
    timeoutSeconds: { min: 5, max: 120, fallback: 30 },
    dailyTokenLimit: { min: 0, max: 1_000_000_000, fallback: 0 },
    requestsPerMinute: { min: 0, max: 10_000, fallback: 30 },
    retentionDays: { min: 1, max: 3650, fallback: 90 },
} as const;

type BoundedKey = keyof typeof AI_SETTING_BOUNDS;

export interface AiSettings {
    timeoutSeconds: number;
    dailyTokenLimit: number;
    requestsPerMinute: number;
    retentionDays: number;
    /** Module id to its own daily cap. A module left out has none. */
    moduleTokenLimits: Record<string, number>;
}

function bounded(key: BoundedKey, raw: unknown): number {
    const { min, max, fallback } = AI_SETTING_BOUNDS[key];
    if (raw === null || raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

function moduleLimits(raw: unknown): Record<string, number> {
    let value = raw;
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        } catch {
            return {};
        }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const limits: Record<string, number> = {};
    for (const [id, cap] of Object.entries(value)) {
        const n = Number(cap);
        if (Number.isFinite(n) && n > 0) limits[id] = Math.min(AI_SETTING_BOUNDS.dailyTokenLimit.max, Math.round(n));
    }
    return limits;
}

/** Saved values, keyed as `AI_SETTING_KEYS` names them, read into numbers inside their bounds. */
export function aiSettingsFrom(values: Record<string, unknown>): AiSettings {
    return {
        timeoutSeconds: bounded("timeoutSeconds", values[AI_SETTING_KEYS.timeoutSeconds]),
        dailyTokenLimit: bounded("dailyTokenLimit", values[AI_SETTING_KEYS.dailyTokenLimit]),
        requestsPerMinute: bounded("requestsPerMinute", values[AI_SETTING_KEYS.requestsPerMinute]),
        retentionDays: bounded("retentionDays", values[AI_SETTING_KEYS.retentionDays]),
        moduleTokenLimits: moduleLimits(values[AI_SETTING_KEYS.moduleTokenLimits]),
    };
}
