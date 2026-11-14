/**
 * The support assistant's settings: their keys, defaults and bounds, and the
 * one reading of a saved value.
 *
 * Import-free, so the settings screen shows the same defaults and bounds the
 * round applies without a client bundle pulling in the server SDK. Every
 * value is the operator's to change.
 *
 * The defaults lean towards a person. A department nobody gave a mode is off,
 * sorting a ticket is off, and answering on its own needs the operator to
 * choose "auto" for a department by name.
 */

/** "drafts" writes drafts for staff; a draft's own status is the singular. */
export const MODES = ["off", "drafts", "auto"] as const;
export type Mode = (typeof MODES)[number];

export const CLASSIFY = ["off", "suggest", "apply"] as const;
export type Classify = (typeof CLASSIFY)[number];

export const REPLY_LANGUAGES = ["member", "site"] as const;
export type ReplyLanguage = (typeof REPLY_LANGUAGES)[number];

export const SETTING_KEYS = {
    modes: "ai_support_modes",
    waitMinutes: "ai_support_wait_minutes",
    days: "ai_support_days",
    from: "ai_support_from",
    to: "ai_support_to",
    maxAuto: "ai_support_max_auto",
    threshold: "ai_support_threshold",
    classifyDepartment: "ai_support_classify_department",
    classifyPriority: "ai_support_classify_priority",
    tone: "ai_support_tone",
    instructions: "ai_support_instructions",
    replyLanguage: "ai_support_reply_language",
    maxLength: "ai_support_max_length",
    sources: "ai_support_sources",
    perSource: "ai_support_per_source",
    siteInfo: "ai_support_site_info",
    model: "ai_support_model",
    perRun: "ai_support_per_run",
    maxAttempts: "ai_support_max_attempts",
    retentionDays: "ai_support_retention_days",
} as const;

export const NUMBER_BOUNDS = {
    waitMinutes: { min: 0, max: 1440, fallback: 15 },
    maxAuto: { min: 0, max: 20, fallback: 2 },
    threshold: { min: 0, max: 100, fallback: 80 },
    maxLength: { min: 200, max: 8000, fallback: 1500 },
    perSource: { min: 0, max: 10, fallback: 3 },
    perRun: { min: 1, max: 50, fallback: 5 },
    maxAttempts: { min: 1, max: 10, fallback: 3 },
    retentionDays: { min: 1, max: 3650, fallback: 90 },
} as const;

export const TEXT_MAX = { tone: 500, instructions: 8000, siteInfo: 8000, model: 120 } as const;

/** Every day of the week, Sunday first, as `Date.getDay` counts them. */
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** A window that starts and ends at the same minute is the whole day. */
export const ALL_DAY = "00:00";

type NumberKey = keyof typeof NUMBER_BOUNDS;

export interface AiSupportConfig {
    /** Department id to mode; a department not named is off. */
    modes: Record<string, Mode>;
    /** How long staff have to answer before the assistant may. */
    waitMinutes: number;
    /** The days it may answer on its own, on the site's clock. */
    days: number[];
    from: string;
    to: string;
    /** Automatic answers one ticket may get; drafts are not counted. */
    maxAuto: number;
    /** How sure the model must be to answer on its own, 0 to 100. */
    threshold: number;
    classifyDepartment: Classify;
    classifyPriority: Classify;
    tone: string;
    /** Empty means the default instructions in the answer's language. */
    instructions: string;
    replyLanguage: ReplyLanguage;
    /** The longest answer, in characters. */
    maxLength: number;
    /** Knowledge sources it may draw on; null until the operator chooses means all of them. */
    sources: string[] | null;
    perSource: number;
    /** What the operator wrote about the site, always handed to the model. */
    siteInfo: string;
    /** Empty means the provider's smart model. */
    model: string;
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

function oneOf<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
    return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function parsed(raw: unknown): unknown {
    if (typeof raw !== "string") return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return undefined;
    }
}

/** A list saved as an array or as its JSON text; null when nothing was saved. */
function list(raw: unknown): string[] | null {
    if (raw === null || raw === undefined || raw === "") return null;
    const value = parsed(raw);
    if (!Array.isArray(value)) return null;
    return [...new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64))];
}

function modes(raw: unknown): Record<string, Mode> {
    const value = parsed(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, Mode> = {};
    for (const [id, mode] of Object.entries(value)) {
        if (id.length <= 64 && (MODES as readonly unknown[]).includes(mode) && mode !== "off") out[id] = mode as Mode;
    }
    return out;
}

function days(raw: unknown): number[] {
    const value = parsed(raw);
    if (!Array.isArray(value)) return [...ALL_DAYS];
    return [...new Set(value.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
}

/** A clock time as HH:MM, or midnight when it is not one. */
function clock(raw: unknown): string {
    return typeof raw === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : ALL_DAY;
}

/** Saved values, keyed as `SETTING_KEYS` names them. */
export function configFrom(values: Record<string, unknown>): AiSupportConfig {
    return {
        modes: modes(values[SETTING_KEYS.modes]),
        waitMinutes: bounded("waitMinutes", values[SETTING_KEYS.waitMinutes]),
        days: days(values[SETTING_KEYS.days]),
        from: clock(values[SETTING_KEYS.from]),
        to: clock(values[SETTING_KEYS.to]),
        maxAuto: bounded("maxAuto", values[SETTING_KEYS.maxAuto]),
        threshold: bounded("threshold", values[SETTING_KEYS.threshold]),
        classifyDepartment: oneOf(values[SETTING_KEYS.classifyDepartment], CLASSIFY, "off"),
        classifyPriority: oneOf(values[SETTING_KEYS.classifyPriority], CLASSIFY, "off"),
        tone: text(values[SETTING_KEYS.tone], TEXT_MAX.tone),
        instructions: text(values[SETTING_KEYS.instructions], TEXT_MAX.instructions),
        replyLanguage: oneOf(values[SETTING_KEYS.replyLanguage], REPLY_LANGUAGES, "member"),
        maxLength: bounded("maxLength", values[SETTING_KEYS.maxLength]),
        sources: list(values[SETTING_KEYS.sources]),
        perSource: bounded("perSource", values[SETTING_KEYS.perSource]),
        siteInfo: text(values[SETTING_KEYS.siteInfo], TEXT_MAX.siteInfo),
        model: text(values[SETTING_KEYS.model], TEXT_MAX.model),
        perRun: bounded("perRun", values[SETTING_KEYS.perRun]),
        maxAttempts: bounded("maxAttempts", values[SETTING_KEYS.maxAttempts]),
        retentionDays: bounded("retentionDays", values[SETTING_KEYS.retentionDays]),
    };
}

export function modeFor(config: AiSupportConfig, departmentId: string): Mode {
    return config.modes[departmentId] ?? "off";
}
