/**
 * What AI calls cost this site, and the limits the operator set on it.
 *
 * Every call leaves one `AiUsage` row, answered or refused, so the AI screen
 * can say what each module spent and how often it failed. A row holds counts
 * and an outcome, never text.
 *
 * The caps are checked before a request leaves. A cap counts the site's day,
 * from midnight on the clock the operator set, because "a thousand tokens a
 * day" means their day. When what was spent cannot be read, a capped call is
 * refused: an unknown spend is not a zero one.
 */
import { prisma } from "@/core/lib/db";
import { readSettingValues } from "@/core/lib/setting-values";
import { siteTimeZone } from "@/core/lib/site-time-setting";
import { startOfDayIn } from "@/core/lib/site-time";
import { errorText, log } from "@/core/lib/logger";
import { AI_SETTING_KEYS, aiSettingsFrom, type AiSettings } from "@/core/lib/ai-settings";

export interface UsageRecord {
    module: string;
    purpose: string;
    provider: string | null;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    outcome: string;
    durationMs: number;
}

/** Written after the call; a failed write is logged and never fails the call. */
export async function recordUsage(record: UsageRecord): Promise<void> {
    try {
        await prisma.aiUsage.create({ data: record });
    } catch (err) {
        log.warn("[ai] usage could not be recorded", { module: record.module, error: errorText(err) });
    }
}

async function tokensSince(since: Date, module?: string): Promise<number> {
    const result = await prisma.aiUsage.aggregate({
        where: { createdAt: { gte: since }, ...(module ? { module } : {}) },
        _sum: { inputTokens: true, outputTokens: true },
    });
    return (result._sum.inputTokens ?? 0) + (result._sum.outputTokens ?? 0);
}

/** Whether `module` may make another call today under the operator's caps. */
export async function withinBudget(module: string, settings: AiSettings): Promise<boolean> {
    const moduleCap = settings.moduleTokenLimits[module] ?? 0;
    if (settings.dailyTokenLimit <= 0 && moduleCap <= 0) return true;
    try {
        const since = startOfDayIn(new Date(), await siteTimeZone());
        if (settings.dailyTokenLimit > 0 && (await tokensSince(since)) >= settings.dailyTokenLimit) return false;
        if (moduleCap > 0 && (await tokensSince(since, module)) >= moduleCap) return false;
        return true;
    } catch (err) {
        log.warn("[ai] spending could not be read; the capped call is refused", { module, error: errorText(err) });
        return false;
    }
}

/** Deletes rows past the operator's retention. Run daily by `core:prune-ai-usage`. */
export async function pruneUsage(): Promise<number> {
    const values = await readSettingValues([AI_SETTING_KEYS.retentionDays]);
    const days = aiSettingsFrom(values).retentionDays;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await prisma.aiUsage.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return result.count;
}

export interface PurposeUsage {
    module: string;
    purpose: string;
    requests: number;
    tokens: number;
    errors: number;
}

/**
 * The AI screen's table: calls per module and purpose over the last `days`
 * site days, today included, counted from the site's midnight so the window
 * the screen names is the window the totals read.
 */
export async function usageOverDays(days: number): Promise<PurposeUsage[]> {
    const since = startOfDayIn(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000), await siteTimeZone());
    const groups = await prisma.aiUsage.groupBy({
        by: ["module", "purpose", "outcome"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
    });
    const rows = new Map<string, PurposeUsage>();
    for (const group of groups) {
        const key = `${group.module}\u0000${group.purpose}`;
        const row = rows.get(key) ?? { module: group.module, purpose: group.purpose, requests: 0, tokens: 0, errors: 0 };
        row.requests += group._count._all;
        row.tokens += (group._sum.inputTokens ?? 0) + (group._sum.outputTokens ?? 0);
        if (group.outcome !== "ok") row.errors += group._count._all;
        rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) => b.tokens - a.tokens || a.module.localeCompare(b.module));
}
