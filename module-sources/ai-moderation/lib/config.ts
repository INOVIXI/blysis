/**
 * AI moderation's settings: their keys, defaults and bounds, and the one
 * reading of a saved value.
 *
 * Import-free, so the settings screen shows the same defaults and bounds the
 * reviewer applies without a client bundle pulling in the server SDK. Every
 * value is the operator's to change; nothing here is the only answer.
 *
 * The defaults lean towards a person. Nothing is rejected until the operator
 * names both the kinds where a violation may be rejected and the reasons the
 * model may give: an empty list means "nowhere" and "none", never "all".
 */

export const SETTING_KEYS = {
    rules: "ai_moderation_rules",
    instructions: "ai_moderation_instructions",
    model: "ai_moderation_model",
    approveAt: "ai_moderation_approve_at",
    rejectAt: "ai_moderation_reject_at",
    kinds: "ai_moderation_kinds",
    rejectKinds: "ai_moderation_reject_kinds",
    reasons: "ai_moderation_reasons",
    batchSize: "ai_moderation_batch_size",
    perRun: "ai_moderation_per_run",
    maxAttempts: "ai_moderation_max_attempts",
    retentionDays: "ai_moderation_retention_days",
} as const;

export const NUMBER_BOUNDS = {
    approveAt: { min: 0, max: 100, fallback: 90 },
    rejectAt: { min: 0, max: 100, fallback: 95 },
    batchSize: { min: 1, max: 20, fallback: 5 },
    perRun: { min: 1, max: 200, fallback: 20 },
    maxAttempts: { min: 1, max: 10, fallback: 3 },
    retentionDays: { min: 1, max: 3650, fallback: 90 },
} as const;

/** How long the rules and the instructions may be. */
export const TEXT_MAX = { rules: 8000, instructions: 8000, model: 120 } as const;

/** A rationale longer than this is cut; it is a note for an admin, not an essay. */
export const RATIONALE_MAX = 600;

type NumberKey = keyof typeof NUMBER_BOUNDS;

export interface AiModerationConfig {
    rules: string;
    /** Empty means the default instructions in the site's language. */
    instructions: string;
    /** Empty means the provider's fast model. */
    model: string;
    approveAt: number;
    rejectAt: number;
    /** Kinds it reviews; empty means every kind set to "review". */
    kinds: string[];
    /** Kinds where a violation may be rejected; anywhere else it is left for a person. */
    rejectKinds: string[];
    /** Reason ids the model may give. */
    reasons: string[];
    batchSize: number;
    perRun: number;
    maxAttempts: number;
    retentionDays: number;
}

function bounded(key: NumberKey, raw: unknown): number {
    const { min, max, fallback } = NUMBER_BOUNDS[key];
    if (raw === null || raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

function text(raw: unknown, max: number): string {
    return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

/** A list saved as an array or as its JSON text; anything else is empty. */
function list(raw: unknown): string[] {
    let value = raw;
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64))];
}

/** Saved values, keyed as `SETTING_KEYS` names them. */
export function configFrom(values: Record<string, unknown>): AiModerationConfig {
    return {
        rules: text(values[SETTING_KEYS.rules], TEXT_MAX.rules),
        instructions: text(values[SETTING_KEYS.instructions], TEXT_MAX.instructions),
        model: text(values[SETTING_KEYS.model], TEXT_MAX.model),
        approveAt: bounded("approveAt", values[SETTING_KEYS.approveAt]),
        rejectAt: bounded("rejectAt", values[SETTING_KEYS.rejectAt]),
        kinds: list(values[SETTING_KEYS.kinds]),
        rejectKinds: list(values[SETTING_KEYS.rejectKinds]),
        reasons: list(values[SETTING_KEYS.reasons]),
        batchSize: bounded("batchSize", values[SETTING_KEYS.batchSize]),
        perRun: bounded("perRun", values[SETTING_KEYS.perRun]),
        maxAttempts: bounded("maxAttempts", values[SETTING_KEYS.maxAttempts]),
        retentionDays: bounded("retentionDays", values[SETTING_KEYS.retentionDays]),
    };
}
