/**
 * Which fee a payment method passes on to the buyer, as plain arithmetic.
 *
 * A fee used to come only from a gateway that offered to declare one, which
 * was Stripe, so every other method's cut came out of the shop's margin. The
 * operator now keeps a row per installed method in the store's own table, and
 * the gateway's offer is what a method with no row falls back to - which is
 * how a site that set its Stripe fee on Stripe's screen keeps charging it.
 *
 * The fixed part may be in a currency other than the shop's, because that is
 * how processors quote it ("2.9% + 0.30 USD"). It is converted into the
 * order's currency before the charge is grossed up, never after: the gross-up
 * divides the fixed part along with the order, and a gateway that settles in
 * yet another currency converts the whole charge once, later. A conversion
 * with no rate is refused, because a flat fee charged in the wrong currency is
 * an amount nobody chose.
 */
import type { ProcessorFee } from "./pricing";

/** One method's row, as the operator saves it. */
export interface FeeRow {
    passOn: boolean;
    percent: number;
    fixed: number;
    /** ISO 4217, uppercase; null means the order's own currency. */
    fixedCurrency: string | null;
}

/** The fee a method carries, before its fixed part is in the order's currency. */
export interface FeeRule {
    percent: number;
    fixed: number;
    fixedCurrency: string | null;
    /** Whose number it is: the operator's row, or the gateway's own offer. */
    source: "store" | "gateway";
}

/** The site setting the table is kept under. */
export const FEE_TABLE_KEY = "store_payment_fees";

const ISO_4217 = /^[A-Z]{3}$/;

/** A figure a fee can be made of: finite and not negative. */
function amount(value: unknown): number {
    const n = typeof value === "string" ? Number(value) : value;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

function currencyCode(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const code = value.trim().toUpperCase();
    return ISO_4217.test(code) ? code : null;
}

/**
 * The table as stored, with every row it cannot use dropped.
 *
 * It is a JSON value an older release, a hand edit or a restore may have
 * written, so nothing in it is taken on trust: a row that is not an object is
 * no row, and a figure that is not a number is zero.
 */
export function readFeeTable(value: unknown): Record<string, FeeRow> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const table: Record<string, FeeRow> = {};
    for (const [provider, raw] of Object.entries(value as Record<string, unknown>)) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const row = raw as Record<string, unknown>;
        table[provider] = {
            passOn: row.passOn === true,
            percent: amount(row.percent),
            fixed: amount(row.fixed),
            fixedCurrency: currencyCode(row.fixedCurrency),
        };
    }
    return table;
}

/**
 * The fee this method passes on, or null.
 *
 * The operator's row wins, switched on or off: a row switched off is an
 * operator who looked at the method and said no, and a gateway's offer does
 * not overrule them. A percentage of 100 or more would gross the charge up to
 * infinity, and `grossUpForFee` leaves such a charge alone, so it is not
 * filtered here a second time.
 */
export function feeRuleFor(row: FeeRow | null | undefined, offer: ProcessorFee | undefined): FeeRule | null {
    if (row) {
        if (!row.passOn) return null;
        const percent = amount(row.percent);
        const fixed = amount(row.fixed);
        if (percent === 0 && fixed === 0) return null;
        return { percent, fixed, fixedCurrency: currencyCode(row.fixedCurrency), source: "store" };
    }
    if (!offer) return null;
    const percent = amount(offer.percent);
    const fixed = amount(offer.fixed);
    if (percent === 0 && fixed === 0) return null;
    // A gateway declares its fixed part in the order's currency; see
    // `PaymentProviderSummary.passOnFee`.
    return { percent, fixed, fixedCurrency: null, source: "gateway" };
}

/**
 * The rule in the order's currency, or a refusal when its fixed part cannot be.
 *
 * `rate` is what one unit of the fixed part's currency is worth in the
 * order's, as the `currency.rate` filter answers it. It is only read when the
 * two differ and there is a fixed part to convert.
 */
export function feeInOrderCurrency(
    rule: Pick<FeeRule, "percent" | "fixed" | "fixedCurrency">,
    orderCurrency: string,
    rate: number | null,
): { ok: true; fee: ProcessorFee } | { ok: false } {
    const from = rule.fixedCurrency?.toUpperCase() ?? null;
    if (rule.fixed <= 0 || from === null || from === orderCurrency.toUpperCase()) {
        return { ok: true, fee: { percent: rule.percent, fixed: rule.fixed } };
    }
    if (rate === null || !Number.isFinite(rate) || rate <= 0) return { ok: false };
    return { ok: true, fee: { percent: rule.percent, fixed: Math.round(rule.fixed * rate * 100) / 100 } };
}
