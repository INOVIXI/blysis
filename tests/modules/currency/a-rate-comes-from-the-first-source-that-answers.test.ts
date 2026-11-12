// @vitest-environment node
/**
 * The rates payments convert with come from the first source that answers.
 *
 * There used to be one source, asked every hour, that publishes once a day.
 * When it was down, nothing was asked instead, and nothing said so. Now an
 * operator lists several and puts them in order; a refresh asks them in that
 * order and settles on the first usable answer.
 *
 * "Usable" carries the weight. A source that answers with something that is
 * not a rate set, or with a rate far from the one on file, is treated as a
 * source that failed: these numbers decide what a buyer is charged in another
 * currency, so a wrong one is money, and the last good set is kept rather than
 * replaced with a guess.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const settings = new Map<string, unknown>();
const stored = new Map<string, number>();
const transaction = vi.fn(async (ops: unknown[]) => ops);

vi.mock("@/core/sdk/server", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    readSettingValues: vi.fn(async (keys: string[]) =>
        Object.fromEntries(keys.map((key) => [key, settings.get(key) ?? null]))),
    prisma: {
        setting: {
            findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
                (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null)),
            upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: { value: unknown }; update: { value: unknown } }) => {
                settings.set(where.key, settings.has(where.key) ? update.value : create.value);
            }),
        },
        exchangeRate: {
            findMany: vi.fn(async () => [...stored].map(([currency, rate]) => ({ currency, rate }))),
            upsert: vi.fn(({ where, update }: { where: { currency: string }; update: { rate: string } }) => {
                stored.set(where.currency, Number(update.rate));
                return where.currency;
            }),
        },
        $transaction: (ops: unknown[]) => transaction(ops),
    },
}));

const { collectRates, refreshRates } = await import("@/modules/currency/lib/rate-refresh");
const { RATE_PROVIDERS } = await import("@/modules/currency/lib/rate-providers");

const provider = (id: string) => {
    const found = RATE_PROVIDERS.find((one) => one.id === id);
    if (!found) throw new Error(`no provider ${id}`);
    return found;
};

type Answer = { status?: number; body: unknown } | "timeout" | "offline";

/** A fetch that answers by host, and remembers every URL it was asked for. */
function fakeFetch(answers: Record<string, Answer>) {
    const asked: string[] = [];
    const impl = vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        asked.push(url.toString());
        const answer = answers[url.host];
        if (answer === undefined || answer === "offline") throw new TypeError("fetch failed");
        if (answer === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        const body = typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body);
        return new Response(body, { status: answer.status ?? 200 });
    });
    return { impl: impl as unknown as typeof fetch, asked };
}

const OPEN_ER = { result: "success", base_code: "USD", rates: { USD: 1, EUR: 0.9, TRY: 40 } };
const FRANKFURTER = { amount: 1, base: "USD", date: "2026-11-10", rates: { EUR: 0.91, TRY: 40.2 } };

beforeEach(() => {
    settings.clear();
    stored.clear();
    transaction.mockClear();
});

describe("asking the sources in order", () => {
    it("takes the first source's answer and does not ask the rest", async () => {
        const { impl, asked } = fakeFetch({ "open.er-api.com": { body: OPEN_ER }, "api.frankfurter.dev": { body: FRANKFURTER } });
        const result = await collectRates({
            providers: [provider("exchangerate-api"), provider("frankfurter")],
            keys: {},
            previous: new Map(),
            maxChangePercent: 10,
            fetch: impl,
        });
        expect(result.answeredBy).toEqual(["exchangerate-api"]);
        expect(result.rates.get("TRY")).toBe(40);
        expect(asked.every((url) => url.startsWith("https://open.er-api.com/"))).toBe(true);
    });

    it("falls back to the next source when the first one errors", async () => {
        const { impl } = fakeFetch({ "open.er-api.com": { status: 503, body: "down" }, "api.frankfurter.dev": { body: FRANKFURTER } });
        const result = await collectRates({
            providers: [provider("exchangerate-api"), provider("frankfurter")],
            keys: {},
            previous: new Map(),
            maxChangePercent: 10,
            fetch: impl,
        });
        expect(result.answeredBy).toEqual(["frankfurter"]);
        expect(result.failures["exchangerate-api"]).toEqual({ code: "http", status: 503 });
        // Frankfurter quotes against the base it was asked for and leaves the
        // base itself out; the set on file always holds it.
        expect(result.rates.get("USD")).toBe(1);
        expect(result.rates.get("TRY")).toBe(40.2);
    });

    it("falls back when the first one times out or cannot be reached", async () => {
        const { impl } = fakeFetch({ "open.er-api.com": "timeout", "cdn.jsdelivr.net": "offline", "api.frankfurter.dev": { body: FRANKFURTER } });
        const result = await collectRates({
            providers: [provider("exchangerate-api"), provider("fawazahmed0"), provider("frankfurter")],
            keys: {},
            previous: new Map(),
            maxChangePercent: 10,
            fetch: impl,
        });
        expect(result.answeredBy).toEqual(["frankfurter"]);
        expect(result.failures["exchangerate-api"]).toEqual({ code: "timeout" });
        expect(result.failures.fawazahmed0).toEqual({ code: "network" });
    });

    it("falls back when an answer is not a rate set", async () => {
        const { impl } = fakeFetch({
            "open.er-api.com": { body: { result: "success", base_code: "USD", rates: { USD: 1, TRY: "forty" } } },
            "api.frankfurter.dev": { body: FRANKFURTER },
        });
        const result = await collectRates({
            providers: [provider("exchangerate-api"), provider("frankfurter")],
            keys: {},
            previous: new Map(),
            maxChangePercent: 10,
            fetch: impl,
        });
        expect(result.failures["exchangerate-api"]).toEqual({ code: "malformed" });
        expect(result.answeredBy).toEqual(["frankfurter"]);
    });

    it("refuses a set quoted against some other base", async () => {
        const { impl } = fakeFetch({ "open.er-api.com": { body: { ...OPEN_ER, base_code: "EUR" } } });
        const result = await collectRates({
            providers: [provider("exchangerate-api")],
            keys: {},
            previous: new Map(),
            maxChangePercent: 10,
            fetch: impl,
        });
        expect(result.answeredBy).toEqual([]);
        expect(result.failures["exchangerate-api"]).toEqual({ code: "malformed" });
    });

    it("skips a source that needs a key nobody entered, without asking it", async () => {
        const { impl, asked } = fakeFetch({ "api.frankfurter.dev": { body: FRANKFURTER } });
        const result = await collectRates({
            providers: [provider("openexchangerates"), provider("frankfurter")],
            keys: {},
            previous: new Map(),
            maxChangePercent: 10,
            fetch: impl,
        });
        expect(result.failures.openexchangerates).toEqual({ code: "noKey" });
        expect(asked.some((url) => new URL(url).hostname === "openexchangerates.org")).toBe(false);
        expect(result.answeredBy).toEqual(["frankfurter"]);
    });

    it("keeps a key out of the failure it records", async () => {
        const { impl } = fakeFetch({ "openexchangerates.org": { status: 401, body: { error: true, message: "invalid_app_id" } } });
        const result = await collectRates({
            providers: [provider("openexchangerates")],
            keys: { openexchangerates: "secret-app-id" },
            previous: new Map(),
            maxChangePercent: 10,
            fetch: impl,
        });
        expect(result.failures.openexchangerates).toEqual({ code: "http", status: 401 });
        expect(JSON.stringify(result)).not.toContain("secret-app-id");
    });
});

describe("the sanity bound", () => {
    it("refuses a rate that moved further than the bound and asks the next source", async () => {
        const { impl } = fakeFetch({
            "open.er-api.com": { body: { ...OPEN_ER, rates: { USD: 1, EUR: 0.9, TRY: 46 } } },
            "api.frankfurter.dev": { body: FRANKFURTER },
        });
        const result = await collectRates({
            providers: [provider("exchangerate-api"), provider("frankfurter")],
            keys: {},
            previous: new Map([["USD", 1], ["EUR", 0.9], ["TRY", 40]]),
            maxChangePercent: 10,
            fetch: impl,
        });
        expect(result.failures["exchangerate-api"]).toEqual({ code: "moved", currency: "TRY", percent: 15 });
        expect(result.answeredBy).toEqual(["frankfurter"]);
        expect(result.rates.get("TRY")).toBe(40.2);
    });

    it("accepts a move inside the bound", async () => {
        const { impl } = fakeFetch({ "open.er-api.com": { body: { ...OPEN_ER, rates: { USD: 1, EUR: 0.9, TRY: 43.9 } } } });
        const result = await collectRates({
            providers: [provider("exchangerate-api")],
            keys: {},
            previous: new Map([["TRY", 40]]),
            maxChangePercent: 10,
            fetch: impl,
        });
        expect(result.answeredBy).toEqual(["exchangerate-api"]);
    });

    it("accepts a currency with nothing on file to compare against", async () => {
        // A first install has no rates at all. Refusing a rate for having no
        // predecessor would mean the set is never written.
        const { impl } = fakeFetch({ "open.er-api.com": { body: OPEN_ER } });
        const result = await collectRates({
            providers: [provider("exchangerate-api")],
            keys: {},
            previous: new Map([["EUR", 0.9]]),
            maxChangePercent: 10,
            fetch: impl,
        });
        expect(result.answeredBy).toEqual(["exchangerate-api"]);
        expect(result.rates.get("TRY")).toBe(40);
    });
});

describe("sources that quote the other way round", () => {
    it("turns the central bank's lira per unit into units per dollar", async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Tarih_Date Tarih="11.11.2026" Date="11/11/2026">
<Currency CrossOrder="0" Kod="USD" CurrencyCode="USD"><Unit>1</Unit><ForexBuying>40.00</ForexBuying><ForexSelling>40.20</ForexSelling></Currency>
<Currency CrossOrder="9" Kod="EUR" CurrencyCode="EUR"><Unit>1</Unit><ForexBuying>44.00</ForexBuying><ForexSelling>44.22</ForexSelling></Currency>
<Currency CrossOrder="3" Kod="JPY" CurrencyCode="JPY"><Unit>100</Unit><ForexBuying>26.00</ForexBuying><ForexSelling>26.13</ForexSelling></Currency>
<Currency CrossOrder="20" Kod="XDR" CurrencyCode="XDR"><Unit>1</Unit><ForexBuying>55</ForexBuying><ForexSelling/></Currency>
</Tarih_Date>`;
        const { impl } = fakeFetch({ "www.tcmb.gov.tr": { body: xml } });
        const result = await collectRates({
            providers: [provider("tcmb")],
            keys: {},
            previous: new Map(),
            maxChangePercent: 10,
            fetch: impl,
        });
        expect(result.answeredBy).toEqual(["tcmb"]);
        // The middle of buying and selling: 40.10 lira to the dollar.
        expect(result.rates.get("TRY")).toBeCloseTo(40.1, 10);
        expect(result.rates.get("USD")).toBe(1);
        // 44.11 lira to the euro, so 40.10 / 44.11 euro to the dollar.
        expect(result.rates.get("EUR")).toBeCloseTo(40.1 / 44.11, 10);
        // Quoted per hundred yen.
        expect(result.rates.get("JPY")).toBeCloseTo(40.1 / (26.065 / 100), 6);
        // A line with no selling price is not a rate and is left out.
        expect(result.rates.has("XDR")).toBe(false);
    });

    it("reads the exchange ticker as lira per dollar and nothing else", async () => {
        const { impl } = fakeFetch({ "data-api.binance.vision": { body: { symbol: "USDTTRY", price: "40.50000000" } } });
        const result = await collectRates({
            providers: [provider("binance")],
            keys: {},
            previous: new Map(),
            maxChangePercent: 10,
            fetch: impl,
        });
        expect(result.rates.get("TRY")).toBe(40.5);
        expect([...result.rates.keys()].sort()).toEqual(["TRY", "USD"]);
    });

    it("lets the next source fill what a partial source does not cover", async () => {
        const { impl } = fakeFetch({
            "data-api.binance.vision": { body: { symbol: "USDTTRY", price: "40.50000000" } },
            "open.er-api.com": { body: OPEN_ER },
            "api.frankfurter.dev": { body: FRANKFURTER },
        });
        const result = await collectRates({
            providers: [provider("binance"), provider("exchangerate-api"), provider("frankfurter")],
            keys: {},
            previous: new Map(),
            maxChangePercent: 10,
            fetch: impl,
        });
        expect(result.answeredBy).toEqual(["binance", "exchangerate-api"]);
        // The partial source keeps the currency it answered for.
        expect(result.rates.get("TRY")).toBe(40.5);
        expect(result.rates.get("EUR")).toBe(0.9);
    });
});

describe("a scheduled refresh", () => {
    it("does what it did before for a site that changed nothing", async () => {
        const { impl, asked } = fakeFetch({ "open.er-api.com": { body: OPEN_ER } });
        const outcome = await refreshRates({ fetch: impl, now: new Date("2026-11-11T10:00:00Z") });
        expect(outcome.kind).toBe("refreshed");
        expect(asked).toHaveLength(1);
        expect(stored.get("TRY")).toBe(40);
        const status = settings.get("currency_rate_status") as { lastSuccessAt: string; answeredBy: string[] };
        expect(status.answeredBy).toEqual(["exchangerate-api"]);
        expect(status.lastSuccessAt).toBe("2026-11-11T10:00:00.000Z");
    });

    it("skips a run when the chosen interval has not passed", async () => {
        settings.set("currency_rate_sources", { intervalMinutes: 15 });
        settings.set("currency_rate_status", { lastAttemptAt: "2026-11-11T10:00:00.000Z", lastSuccessAt: "2026-11-11T10:00:00.000Z" });
        const { impl, asked } = fakeFetch({ "open.er-api.com": { body: OPEN_ER } });

        const early = await refreshRates({ fetch: impl, now: new Date("2026-11-11T10:10:00Z") });
        expect(early.kind).toBe("skipped");
        expect(asked).toHaveLength(0);

        // The scheduler runs every five minutes and a run lands a little after
        // its slot, so the run at the quarter hour is the one that refreshes.
        const due = await refreshRates({ fetch: impl, now: new Date("2026-11-11T10:14:40Z") });
        expect(due.kind).toBe("refreshed");
    });

    it("runs at once when an operator asks, whatever the interval", async () => {
        settings.set("currency_rate_sources", { intervalMinutes: 1440 });
        settings.set("currency_rate_status", { lastAttemptAt: "2026-11-11T10:00:00.000Z", lastSuccessAt: "2026-11-11T10:00:00.000Z" });
        const { impl } = fakeFetch({ "open.er-api.com": { body: OPEN_ER } });
        const outcome = await refreshRates({ fetch: impl, now: new Date("2026-11-11T10:01:00Z"), force: true });
        expect(outcome.kind).toBe("refreshed");
    });

    it("tries again on the next run after a refresh that failed", async () => {
        // The interval counts from the last refresh that stored something. A
        // sweep that found every source down must not park the next try for
        // a whole day on a site that refreshes daily.
        settings.set("currency_rate_sources", { intervalMinutes: 1440 });
        const down = fakeFetch({ "open.er-api.com": { status: 503, body: "" } });
        expect((await refreshRates({ fetch: down.impl, now: new Date("2026-11-11T10:00:00Z") })).kind).toBe("failed");

        const up = fakeFetch({ "open.er-api.com": { body: OPEN_ER } });
        expect((await refreshRates({ fetch: up.impl, now: new Date("2026-11-11T10:05:00Z") })).kind).toBe("refreshed");
    });

    it("keeps the last good rates and says why when every source fails", async () => {
        stored.set("TRY", 40);
        const { impl } = fakeFetch({ "open.er-api.com": { status: 500, body: "" } });
        const outcome = await refreshRates({ fetch: impl, now: new Date("2026-11-11T10:00:00Z") });
        expect(outcome.kind).toBe("failed");
        expect(transaction).not.toHaveBeenCalled();
        expect(stored.get("TRY")).toBe(40);
        const status = settings.get("currency_rate_status") as { providers: Record<string, { lastError: unknown }> };
        expect(status.providers["exchangerate-api"].lastError).toEqual({ code: "http", status: 500 });
    });

    it("asks the enabled sources in the operator's order", async () => {
        settings.set("currency_rate_sources", {
            intervalMinutes: 60,
            providers: [
                { id: "frankfurter", enabled: true },
                { id: "exchangerate-api", enabled: false },
                { id: "tcmb", enabled: true },
            ],
        });
        const { impl, asked } = fakeFetch({ "api.frankfurter.dev": { status: 502, body: "" }, "www.tcmb.gov.tr": "offline" });
        await refreshRates({ fetch: impl, now: new Date("2026-11-11T10:00:00Z") });
        expect(asked.map((url) => new URL(url).host)).toEqual(["api.frankfurter.dev", "www.tcmb.gov.tr"]);
    });
});
