/**
 * Giving a percentage of a purchase back as credits.
 *
 * The rule is one line and the way it goes wrong is not. Credits are spendable
 * in the shop, so an order paid with credits that earns credits is a loop:
 * spend a hundred, get five back, spend those, get more. Nothing looks wrong
 * at any single step - every row is a real award for a real order - and the
 * balance climbs on its own. Cashback is paid on money that arrived, and an
 * order settled from the wallet earns nothing.
 *
 * An order with no recorded payment method is treated the same way. It is one
 * this shop cannot say was paid with money, and guessing in the earning
 * direction is the expensive way to be wrong.
 */

/** An order, as much of it as this decision needs. */
export interface EarningOrder {
    total: unknown;
    paymentMethod: string | null | undefined;
}

export type CashbackDecision =
    | { award: number }
    | { skip: "no-rate" | "paid-with-credits" | "nothing-paid" | "rounds-to-nothing" };

/** The wallet the store runs itself. Money that never arrived from outside. */
const WALLET = "credits";

export function cashbackFor(order: EarningOrder, percent: number): CashbackDecision {
    if (!Number.isFinite(percent) || percent <= 0) return { skip: "no-rate" };

    const method = (order.paymentMethod ?? "").trim().toLowerCase();
    if (method === "" || method === WALLET) return { skip: "paid-with-credits" };

    const total = Number(order.total);
    if (!Number.isFinite(total) || total <= 0) return { skip: "nothing-paid" };

    // Down, not up. Rounding up pays a credit on every trivial sale, which is
    // a scheme somebody will farm rather than a reward for spending.
    const earned = Math.floor((total * percent) / 100);
    if (earned <= 0) return { skip: "rounds-to-nothing" };

    return { award: earned };
}

/** An order's total and the currency it was paid in. */
export interface PaidSale {
    total: unknown;
    currency: string | null | undefined;
}

/**
 * The sale in the shop's base currency, which is what credits are priced in.
 *
 * `rate` turns one unit of the order's currency into the base; the caller asks
 * for it. An order paid in lira on a shop priced in dollars earned credits as
 * if every lira were a dollar until this was asked. With no rate the answer is
 * null and nothing is paid, for the reason the rest of this file gives:
 * guessing in the earning direction is the expensive way to be wrong.
 */
export function saleInBase(sale: PaidSale, base: string, rate: number | null): number | null {
    const total = Number(sale.total);
    if (!Number.isFinite(total)) return null;
    const paidIn = (sale.currency ?? "").trim().toUpperCase();
    if (paidIn === "" || paidIn === base.trim().toUpperCase()) return total;
    if (rate === null || !Number.isFinite(rate) || rate <= 0) return null;
    return total * rate;
}
