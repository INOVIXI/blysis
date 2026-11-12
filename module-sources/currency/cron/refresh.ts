import { log } from "@/core/sdk/server";
import { refreshRates } from "../lib/rate-refresh";

/**
 * Currency rate refresh cron job.
 *
 * Runs at the scheduler's five-minute cadence and refreshes only when the
 * interval the operator chose has passed; which sources are asked, in what
 * order and how their answers are checked is in `lib/rate-refresh.ts`. It
 * writes the `ExchangeRate` table and never the admin-managed currency
 * config, so the rates an operator typed for display stay as they were.
 */
export default async function refreshCurrencyRates(): Promise<void> {
    try {
        await refreshRates();
    } catch (err) {
        log.error("[cron] currency-rate-refresh failed", { error: err instanceof Error ? err.message : String(err) });
    }
}
