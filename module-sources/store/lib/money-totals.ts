/**
 * Adding up money that was paid in more than one currency.
 *
 * Every order and every top-up keeps the currency it was paid in. A total that
 * adds those amounts as if they were all in the site's currency is right only
 * until somebody changes that setting: a shop that took lira for years and
 * then priced in dollars showed a member who had paid 1,514 TRY as having paid
 * 1,514 USD, and a visitor reading in lira saw that multiplied by the dollar
 * rate again, about 77,000.
 *
 * So each amount is converted into the currency the total reports in, and only
 * then added. A row keeps no rate or base amount from the day it was paid
 * (`chargeAmount` is the gateway's figure, grossed up for any fee passed on, not
 * the price in the site's currency), so the conversion is at today's rate, from
 * whoever answers `currency.rate`.
 *
 * A currency nobody quotes a rate for is left out and logged. Checkout refuses
 * in the same situation, because there a guess is a wrong charge; here a
 * ranking without those rows is still true about every row it shows, while
 * counting them at face value is the bug this file exists to stop.
 * `tests/modules/store/a-total-adds-what-was-paid-in-one-currency.test.ts`
 * holds every total built on this to that.
 */
import { applyFiltersAsync } from "@/core/sdk";
import { log } from "@/core/sdk/server";

/** One amount, in the currency it was paid in, and what it is a total of. */
export interface PaidAmount<K> {
    key: K;
    currency: string;
    amount: number;
}

async function rateInto(from: string, to: string): Promise<number | null> {
    if (from === to) return 1;
    const rate = await applyFiltersAsync("currency.rate", null, { from, to }).catch(() => null);
    return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * The total for every key, in `target`. The rate for each currency is asked
 * once, however many rows carry it.
 */
export async function totalsIn<K>(target: string, rows: PaidAmount<K>[]): Promise<Map<K, number>> {
    const into = target.trim().toUpperCase();
    const rates = new Map<string, number | null>();
    for (const code of new Set(rows.map((row) => row.currency.trim().toUpperCase()))) {
        const rate = await rateInto(code, into);
        if (rate === null) log.warn("[store] a total leaves out money it has no exchange rate for", { from: code, to: into });
        rates.set(code, rate);
    }

    const totals = new Map<K, number>();
    for (const row of rows) {
        const rate = rates.get(row.currency.trim().toUpperCase());
        if (rate === null || rate === undefined) continue;
        totals.set(row.key, (totals.get(row.key) ?? 0) + row.amount * rate);
    }
    for (const [key, total] of totals) totals.set(key, Math.round(total * 100) / 100);
    return totals;
}

/** The totals, largest first, for a ranking that is only cut after it is converted. */
export function largestFirst<K>(totals: Map<K, number>): [K, number][] {
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}
