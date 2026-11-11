/**
 * Which rate sources a site asks, in what order, and how often.
 *
 * Two settings rows rather than one. The operator owns the configuration and
 * the screen writes it whole; the refresh owns the status and writes it every
 * time it runs. In one row, a save in flight would overwrite the status the
 * refresh just wrote, and the refresh would rewrite the sealed keys every few
 * minutes.
 *
 * A site that never opens the screen has no configuration row, and reads the
 * default: the one source this module always used, once an hour. That is
 * exactly what it did before sources could be chosen.
 */
import { z } from "zod";
import { RATE_PROVIDERS } from "./rate-providers";

export const RATE_CONFIG_KEY = "currency_rate_sources";
export const RATE_STATUS_KEY = "currency_rate_status";

/**
 * The intervals an operator may pick, in minutes. The scheduler only knows
 * a handful of named cadences, so the job runs at the shortest of these and
 * skips a run until the chosen one has passed.
 */
export const REFRESH_INTERVALS = [5, 15, 30, 60, 1440] as const;

const providerIds = RATE_PROVIDERS.map((provider) => provider.id);

export const rateConfigSchema = z.object({
    intervalMinutes: z.number().refine((n) => (REFRESH_INTERVALS as readonly number[]).includes(n)).default(60),
    /** A new rate further than this from the stored one is refused. */
    maxChangePercent: z.number().min(1).max(100).default(10),
    /** The operator's order, enabled or not. */
    providers: z.array(z.object({ id: z.string().refine((id) => providerIds.includes(id)), enabled: z.boolean() })).max(50).default([]),
    // Empty means "leave the stored key alone": the screen never receives it.
    openexchangeratesKey: z.string().max(200).default(""),
});

export type RateConfig = z.infer<typeof rateConfigSchema>;

/**
 * The stored configuration with every source in it exactly once.
 *
 * A source added in a later version of this module is appended, switched
 * off, so an upgrade never starts asking somebody new without the operator
 * choosing to. An id this version no longer knows is dropped.
 */
export function readRateConfig(stored: unknown): RateConfig {
    const raw = stored && typeof stored === "object" && !Array.isArray(stored) ? { ...(stored as Record<string, unknown>) } : {};
    if (Array.isArray(raw.providers)) {
        raw.providers = raw.providers.filter((entry: { id?: unknown } | null) =>
            typeof entry?.id === "string" && providerIds.includes(entry.id));
    }
    const parsed = rateConfigSchema.safeParse(raw);
    const config = parsed.success ? parsed.data : rateConfigSchema.parse({});
    const hadOrder = config.providers.length > 0;

    const seen = new Set<string>();
    const providers = config.providers.filter((entry) => {
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
    });
    for (const id of providerIds) {
        if (seen.has(id)) continue;
        // With no order on file at all, the first source is the one this
        // module has always asked.
        providers.push({ id, enabled: !hadOrder && id === providerIds[0] });
    }
    return { ...config, providers };
}

/** Why one source's answer was not used. Words for each live in the catalogue. */
export type RateFailure =
    | { code: "http"; status: number }
    | { code: "timeout" }
    | { code: "network" }
    | { code: "malformed" }
    | { code: "noKey" }
    | { code: "moved"; currency: string; percent: number };

export interface ProviderStatus {
    lastSuccessAt?: string;
    lastErrorAt?: string;
    lastError?: RateFailure | null;
}

export interface RateStatus {
    /** When a refresh last ran, whatever came of it. */
    lastAttemptAt?: string;
    /** When one last stored rates. The interval counts from here. */
    lastSuccessAt?: string;
    /** The sources whose rates the last successful refresh stored, in order. */
    answeredBy?: string[];
    providers?: Record<string, ProviderStatus>;
}
