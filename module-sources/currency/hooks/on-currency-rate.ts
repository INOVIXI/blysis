/**
 * Answers "how many of one currency make one of another".
 *
 * Asked when a gateway settles in a currency the shop does not price in. The
 * store cannot read this module's table - a module reaches another only
 * through a published contract - so the question travels as a filter and this
 * is the only thing that has to know rates are kept against a base.
 *
 * Answering null is deliberate and is what the caller is built for: the
 * payment does not start, the order stays unpaid, and an operator can put a
 * rate in. Guessing one would charge somebody the wrong amount and mark it
 * paid.
 */
import { prisma } from "@/core/sdk/server";
import { crossRate } from "../lib/rates";

/**
 * The pair a rate is asked for.
 *
 * Stated here rather than taken from `HookHandlerFor<"currency.rate">`:
 * that shape is declared by the store, and a site that installs this module
 * without it still builds this file. Without the declaration the hook's types
 * fall back to `unknown`, and the reads below failed the whole site's build.
 * With both installed, `npm run typecheck:modules` holds these against the
 * declared contract.
 */
interface RateQuestion {
    from: string;
    to: string;
}

const onCurrencyRate = async (current: number | null, context?: RateQuestion): Promise<number | null> => {
    // Somebody already answered. Two modules quoting rates is a site with two
    // opinions about what a price is; the first one wins, as everywhere else.
    if (current !== null && current !== undefined) return current;
    if (!context) return current ?? null;

    const rows = await prisma.exchangeRate.findMany({ select: { currency: true, rate: true } });
    const rates = new Map(rows.map((row) => [row.currency.toUpperCase(), Number(row.rate)]));
    return crossRate(context.from, context.to, rates);
};

export default onCurrencyRate;
