/**
 * The places exchange rates can be fetched from, and how each one is read.
 *
 * Every adapter turns its source's answer into one shape: how many of each
 * currency make one US dollar, the base `ExchangeRate` has always been kept
 * in. Several sources quote the other way round (the Turkish central bank
 * gives lira per unit of foreign currency, the ECB set comes without its own
 * base), and an inversion done at the wrong end charges a buyer a fortieth of
 * the price. So each conversion lives in its adapter and has a case of its own
 * in `a-rate-comes-from-the-first-source-that-answers`.
 *
 * The hosts are constants. Nothing an operator types becomes part of a URL
 * except a key, which goes in the query string of the one host that asked for
 * it; `rate-refresh.ts` refuses any URL whose host is not the provider's own.
 *
 * What each entry says about itself (key, how often the data moves, the free
 * quota) was read off the provider's own documentation in November 2026. The
 * admin screen shows it so an operator can choose without reading five
 * pricing pages, and warns when the chosen interval would spend a free quota
 * before the month is out.
 */

/** How often the numbers behind a source actually change. */
export type RateCadence = "intraday" | "hourly" | "daily";

export interface RateProvider {
    id: string;
    /** A proper name, the same in every language. */
    name: string;
    host: string;
    /** The field of the stored configuration that holds this source's key. */
    keyField?: "openexchangeratesKey";
    cadence: RateCadence;
    /** Requests a month on the free plan, where the provider meters them. */
    freeRequestsPerMonth?: number;
    /**
     * The currencies this source can answer for, when it is not a full set.
     * A partial source answers for these and leaves the rest to the next one.
     */
    covers?: readonly string[];
    /** True when the number is a stand-in for the rate rather than the rate. */
    approximate?: boolean;
    url: (key: string) => string;
    /** The answer as units per dollar. Throws on anything that is not one. */
    read: (body: string) => Record<string, number>;
}

/** An answer that is not a rate set. The refresh records it as `malformed`. */
export class MalformedRates extends Error {}

function json(body: string): Record<string, unknown> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        throw new MalformedRates();
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new MalformedRates();
    return parsed as Record<string, unknown>;
}

function ratesObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new MalformedRates();
    return value as Record<string, unknown>;
}

/**
 * The currencies a rate is kept for. Sources also list crypto tokens and
 * private codes (`FOK`, `GGP`), which no gateway settles in and whose prices
 * swing far enough to trip the sanity bound on every refresh.
 */
const ISO_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

/** Every value a usable rate, codes upper-cased, the dollar itself at 1. */
function perDollar(rates: Record<string, unknown>): Record<string, number> {
    const out: Record<string, number> = { USD: 1 };
    for (const [raw, value] of Object.entries(rates)) {
        const code = raw.toUpperCase();
        if (!ISO_CURRENCIES.has(code)) continue;
        const rate = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
        if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) throw new MalformedRates();
        out[code] = rate;
    }
    if (out.USD !== 1) throw new MalformedRates();
    return out;
}

/** One element's text inside a `<Currency>` block of the central bank's file. */
function tag(block: string, name: string): string | null {
    const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(block);
    return match ? match[1].trim() : null;
}

/**
 * The Turkish central bank's daily file, as units per dollar.
 *
 * It quotes lira per `Unit` of each currency (per hundred for the yen), with
 * a buying and a selling price. The middle of the two is taken, which is what
 * the other sources publish. A line missing either price is not a rate.
 */
function readTcmb(body: string): Record<string, number> {
    const liraPer: Record<string, number> = {};
    for (const match of body.matchAll(/<Currency\b[^>]*\bCurrencyCode="([A-Z]{3})"[^>]*>([\s\S]*?)<\/Currency>/g)) {
        const [, code, block] = match;
        const unit = Number(tag(block, "Unit"));
        const buying = Number(tag(block, "ForexBuying") || Number.NaN);
        const selling = Number(tag(block, "ForexSelling") || Number.NaN);
        const mid = (buying + selling) / 2 / unit;
        if (!Number.isFinite(mid) || mid <= 0) continue;
        liraPer[code] = mid;
    }
    const liraPerDollar = liraPer.USD;
    if (!liraPerDollar) throw new MalformedRates();

    const perDollarRates: Record<string, number> = { TRY: liraPerDollar };
    for (const [code, lira] of Object.entries(liraPer)) {
        if (code !== "USD") perDollarRates[code] = liraPerDollar / lira;
    }
    return perDollar(perDollarRates);
}

export const RATE_PROVIDERS: readonly RateProvider[] = [
    {
        // The source this module has always used. Its open endpoint needs no
        // key and publishes once a day; the documentation asks that pages
        // showing its rates credit it.
        id: "exchangerate-api",
        name: "ExchangeRate-API",
        host: "open.er-api.com",
        cadence: "daily",
        url: () => "https://open.er-api.com/v6/latest/USD",
        read: (body) => {
            const data = json(body);
            if (data.result !== "success" || data.base_code !== "USD") throw new MalformedRates();
            return perDollar(ratesObject(data.rates));
        },
    },
    {
        // The European Central Bank's reference rates, about thirty
        // currencies, published once each working day.
        id: "frankfurter",
        name: "Frankfurter (ECB)",
        host: "api.frankfurter.dev",
        cadence: "daily",
        url: () => "https://api.frankfurter.dev/v1/latest?base=USD",
        read: (body) => {
            const data = json(body);
            if (data.base !== "USD") throw new MalformedRates();
            return perDollar(ratesObject(data.rates));
        },
    },
    {
        // An open dataset rebuilt daily and served from the jsDelivr CDN.
        // It carries crypto tokens beside the currencies; `perDollar` keeps
        // only ISO 4217 codes.
        id: "fawazahmed0",
        name: "Currency API (jsDelivr)",
        host: "cdn.jsdelivr.net",
        cadence: "daily",
        url: () => "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
        read: (body) => perDollar(ratesObject(json(body).usd)),
    },
    {
        // The Turkish central bank's indicative rates, once each working day
        // in the afternoon, Turkish time.
        id: "tcmb",
        name: "TCMB",
        host: "www.tcmb.gov.tr",
        cadence: "daily",
        url: () => "https://www.tcmb.gov.tr/kurlar/today.xml",
        read: readTcmb,
    },
    {
        // A crypto exchange's last trade of USDT against the lira. USDT is a
        // token meant to track the dollar, not the dollar, so this is an
        // approximation that moves through the day while the official rates
        // wait for tomorrow. Served from Binance's public market-data host,
        // which needs no key.
        id: "binance",
        name: "Binance USDT/TRY",
        host: "data-api.binance.vision",
        cadence: "intraday",
        covers: ["TRY"],
        approximate: true,
        url: () => "https://data-api.binance.vision/api/v3/ticker/price?symbol=USDTTRY",
        read: (body) => {
            const data = json(body);
            if (data.symbol !== "USDTTRY") throw new MalformedRates();
            return perDollar({ TRY: data.price });
        },
    },
    {
        // Hourly rates on the free plan, which allows 1,000 requests a month
        // and quotes against the dollar only.
        id: "openexchangerates",
        name: "Open Exchange Rates",
        host: "openexchangerates.org",
        keyField: "openexchangeratesKey",
        cadence: "hourly",
        freeRequestsPerMonth: 1000,
        url: (key) => `https://openexchangerates.org/api/latest.json?app_id=${encodeURIComponent(key)}`,
        read: (body) => {
            const data = json(body);
            if (data.base !== "USD") throw new MalformedRates();
            return perDollar(ratesObject(data.rates));
        },
    },
];
