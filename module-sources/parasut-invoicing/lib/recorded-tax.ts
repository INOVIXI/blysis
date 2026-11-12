/**
 * The tax an order was charged, as the store recorded it on the order.
 *
 * The store keeps the rate and the reason under `metadata.tax` since a tax
 * module can charge by the buyer's country: a sale abroad may be zero-rated
 * as an export or reverse-charged to a business, and its invoice has to say
 * so rather than carry the shop's domestic rate.
 */

/** What this module reads of the record. */
export interface RecordedTax {
    rate: number;
    /** `standard`, `domestic`, `destination`, `export`, `reverse_charge` or `exempt`. */
    reason: string;
}

/** The record on an order, or null for one placed before orders kept one or one that cannot be read. */
export function recordedTax(metadata: unknown): RecordedTax | null {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
    const tax = (metadata as Record<string, unknown>).tax;
    if (!tax || typeof tax !== "object") return null;
    const { rate, reason } = tax as Record<string, unknown>;
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 100) return null;
    return { rate, reason: typeof reason === "string" ? reason : "standard" };
}

/** The rate for the invoice: the order's own, or the shop's for an order without one. */
export function invoiceRate(recorded: RecordedTax | null, shopRate: number): number {
    return recorded ? recorded.rate : shopRate;
}

/**
 * Whether the legal document may go out without a person.
 *
 * Not for a sale that carried no tax. A zero-rated document needs an
 * exemption code, and which one applies - an export, a reverse charge, an
 * exemption - is the operator's decision against their own tax registration,
 * not something to pick here. The invoice is still recorded; the document
 * waits for the per-sale button.
 */
export function sendsByItself(recorded: RecordedTax | null): boolean {
    return recorded === null || recorded.rate > 0;
}
