/**
 * Fetching a fresh set of rates, from the first source that gives a usable one.
 *
 * These are the rates `currency.rate` answers with, which is what a gateway
 * that settles in another currency is charged through. So the rule is the one
 * `rates.ts` states: a wrong number is money gone, and keeping yesterday's
 * number is not. Whatever a source returns is checked before it is stored:
 *
 * - it has to parse into a rate set against the dollar, every rate a positive
 *   finite number (`rate-providers.ts` throws on anything else);
 * - no currency in it may have moved further than the operator's bound from
 *   the rate on file. One rate out of bounds refuses the whole answer, since a
 *   source that has one wrong has given no reason to trust the others, and the
 *   next source is asked. A currency with nothing on file has nothing to be
 *   compared with and is taken, or a first install would never fill.
 *
 * When no source gives a usable answer nothing is written, and the status
 * says which source failed and how.
 *
 * Guarded by `a-rate-comes-from-the-first-source-that-answers`.
 */
import { log, prisma, readSettingValues } from "@/core/sdk/server";
import { RATE_PROVIDERS, MalformedRates, type RateProvider } from "./rate-providers";
import {
    RATE_CONFIG_KEY,
    RATE_STATUS_KEY,
    readRateConfig,
    type RateFailure,
    type RateStatus,
} from "./rate-config";

/** Long enough for a slow CDN, short enough that one dead host never stalls the scheduler. */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Slack on the interval. The scheduler fires every five minutes and a run
 * lands a little after its slot, so a run that is a few seconds short of the
 * interval is the one meant to refresh, not one to skip.
 */
const INTERVAL_SLACK_MS = 60_000;

interface CollectInput {
    /** The enabled sources, in the operator's order. */
    providers: readonly RateProvider[];
    /** By provider id. */
    keys: Partial<Record<string, string>>;
    previous: Map<string, number>;
    maxChangePercent: number;
    fetch?: typeof fetch;
}

interface Collected {
    rates: Map<string, number>;
    answeredBy: string[];
    failures: Record<string, RateFailure>;
}

/** What one source said, or why it is not used. */
async function ask(
    provider: RateProvider,
    key: string,
    doFetch: typeof fetch,
): Promise<{ rates: Record<string, number> } | { failure: RateFailure }> {
    if (provider.keyField && !key) return { failure: { code: "noKey" } };

    const url = new URL(provider.url(key));
    // The adapter builds the URL from a constant, but a key with a slash or
    // an `@` in it is still text an operator typed. Only the provider's own
    // host, only https.
    if (url.protocol !== "https:" || url.host !== provider.host) return { failure: { code: "malformed" } };

    let body: string;
    try {
        const res = await doFetch(url, {
            headers: { accept: "application/json, text/xml" },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            // A redirect could only take the request somewhere this list
            // never named.
            redirect: "error",
        });
        if (!res.ok) return { failure: { code: "http", status: res.status } };
        body = await res.text();
    } catch (err) {
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        return { failure: timedOut ? { code: "timeout" } : { code: "network" } };
    }

    try {
        const rates = provider.read(body);
        if (Object.keys(rates).length < 2) return { failure: { code: "malformed" } };
        for (const code of provider.covers ?? []) {
            if (!(code in rates)) return { failure: { code: "malformed" } };
        }
        return { rates };
    } catch (err) {
        if (err instanceof MalformedRates) return { failure: { code: "malformed" } };
        throw err;
    }
}

/** The first currency that moved further than the bound, with how far. */
function outOfBounds(
    rates: Record<string, number>,
    previous: Map<string, number>,
    maxChangePercent: number,
): { currency: string; percent: number } | null {
    for (const [currency, rate] of Object.entries(rates)) {
        const before = previous.get(currency);
        if (before === undefined || !Number.isFinite(before) || before <= 0) continue;
        const percent = Math.abs(rate / before - 1) * 100;
        if (percent > maxChangePercent) {
            return { currency, percent: Math.round(percent * 10) / 10 };
        }
    }
    return null;
}

/**
 * Ask the sources in order until one with a full set answers.
 *
 * A partial source (one that covers a few currencies, like the exchange
 * ticker) answers for those and the next source is still asked, to fill in
 * the rest without overwriting what the partial one said.
 */
export async function collectRates(input: CollectInput): Promise<Collected> {
    const doFetch = input.fetch ?? fetch;
    const rates = new Map<string, number>();
    const answeredBy: string[] = [];
    const failures: Record<string, RateFailure> = {};

    for (const provider of input.providers) {
        const key = provider.keyField ? (input.keys[provider.id] ?? "") : "";
        const answer = await ask(provider, key, doFetch);
        if ("failure" in answer) {
            failures[provider.id] = answer.failure;
            continue;
        }

        const moved = outOfBounds(answer.rates, input.previous, input.maxChangePercent);
        if (moved) {
            failures[provider.id] = { code: "moved", ...moved };
            continue;
        }

        for (const [code, rate] of Object.entries(answer.rates)) {
            if (!rates.has(code)) rates.set(code, rate);
        }
        answeredBy.push(provider.id);
        if (!provider.covers) break;
    }

    return { rates, answeredBy, failures };
}

export type RefreshOutcome =
    | { kind: "skipped" }
    | { kind: "refreshed"; answeredBy: string[]; updated: number }
    | { kind: "failed"; failures: Record<string, RateFailure> };

interface RefreshOptions {
    /** An operator pressed "refresh now": run whatever the interval says. */
    force?: boolean;
    now?: Date;
    fetch?: typeof fetch;
}

/** The status row as stored, or an empty one. */
async function readStatus(): Promise<RateStatus> {
    const row = await prisma.setting.findUnique({ where: { key: RATE_STATUS_KEY } });
    const value = row?.value;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as RateStatus) : {};
}

async function writeStatus(status: RateStatus): Promise<void> {
    const value = status as object;
    await prisma.setting.upsert({
        where: { key: RATE_STATUS_KEY },
        create: { key: RATE_STATUS_KEY, value, module: "currency" },
        update: { value },
    });
}

/** One refresh, as the scheduler or the admin screen runs it. */
export async function refreshRates(options: RefreshOptions = {}): Promise<RefreshOutcome> {
    const now = options.now ?? new Date();
    // Through the SDK: the keys are declared credentials and arrive sealed.
    const values = await readSettingValues([RATE_CONFIG_KEY]);
    const config = readRateConfig(values[RATE_CONFIG_KEY]);
    const status = await readStatus();

    // From the last refresh that stored something, not the last attempt: a
    // sweep that found every source down is tried again on the next run
    // rather than a whole interval later.
    if (!options.force && status.lastSuccessAt) {
        const since = now.getTime() - new Date(status.lastSuccessAt).getTime();
        if (since >= 0 && since < config.intervalMinutes * 60_000 - INTERVAL_SLACK_MS) return { kind: "skipped" };
    }

    const enabled = config.providers
        .filter((entry) => entry.enabled)
        .map((entry) => RATE_PROVIDERS.find((provider) => provider.id === entry.id))
        .filter((provider): provider is RateProvider => provider !== undefined);

    const rows = await prisma.exchangeRate.findMany({ select: { currency: true, rate: true } });
    const previous = new Map(rows.map((row) => [row.currency.toUpperCase(), Number(row.rate)]));

    const { rates, answeredBy, failures } = await collectRates({
        providers: enabled,
        keys: Object.fromEntries(enabled.flatMap((provider) =>
            (provider.keyField ? [[provider.id, config[provider.keyField]]] : []))),
        previous,
        maxChangePercent: config.maxChangePercent,
        fetch: options.fetch,
    });

    const at = now.toISOString();
    const providers = { ...(status.providers ?? {}) };
    for (const [id, failure] of Object.entries(failures)) {
        providers[id] = { ...providers[id], lastErrorAt: at, lastError: failure };
    }
    for (const id of answeredBy) {
        providers[id] = { ...providers[id], lastSuccessAt: at, lastError: null };
    }

    if (answeredBy.length === 0) {
        await writeStatus({ ...status, lastAttemptAt: at, providers });
        // Codes only: a failure never carries the URL, so it never carries a key.
        log.warn("cron: no exchange rate source answered", { job: "currency:refresh", failures });
        return { kind: "failed", failures };
    }

    await prisma.$transaction(
        [...rates].map(([currency, rate]) => prisma.exchangeRate.upsert({
            where: { currency },
            create: { currency, rate: rate.toString() },
            update: { rate: rate.toString() },
        })),
    );
    await writeStatus({ lastAttemptAt: at, lastSuccessAt: at, answeredBy, providers });
    log.info("cron: currency rates refreshed", { job: "currency:refresh", answeredBy, updated: rates.size });
    return { kind: "refreshed", answeredBy, updated: rates.size };
}
