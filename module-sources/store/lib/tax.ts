/**
 * The tax a sale carries, as the store records and names it.
 *
 * The store used to own tax outright: one rate and one switch in its own
 * settings, and a line reading "Tax (20%)" in English on every processor's
 * page whatever the tax is called where the shop is. It now asks the
 * `store.tax` filter, and its own settings are only the answer when nothing
 * installed here answers instead. A tax module can then charge by the buyer's
 * country, call the tax what the law calls it, and leave on the order the
 * evidence and the reason an invoice needs.
 *
 * Nothing here reads a request or the database; `tax-server.ts` does.
 */

const COUNTRY = /^[A-Z]{2}$/;
const PRESETS: readonly StoreTaxLabelPreset[] = ["tax", "vat", "gst", "sales_tax"];
const REASONS: readonly StoreTaxReason[] = ["standard", "domestic", "destination", "export", "reverse_charge", "exempt"];
const MAX_LABEL = 40;

/**
 * Each known label as a processor's page prints it.
 *
 * English, and not translated, for the reason the fee line is not: these are
 * handed to a processor to print on its own page, with no locale to choose
 * by. An operator who wants the local name there sets it as their own label,
 * which travels exactly as typed.
 */
const PROCESSOR_NAMES: Record<StoreTaxLabelPreset, string> = {
    tax: "Tax",
    vat: "VAT",
    gst: "GST",
    sales_tax: "Sales tax",
};

/** The answer a shop with no tax module gives: its own two settings. */
export function storeTaxAnswer(settings: { taxRate: number; taxIncluded: boolean }, billingCountry: string | null): StoreTaxAnswer {
    const rate = clampRate(settings.taxRate);
    return {
        rate,
        included: settings.taxIncluded === true,
        label: { kind: "preset", id: "tax" },
        country: countryOf(billingCountry),
        reason: rate === 0 ? "exempt" : "standard",
        evidence: null,
    };
}

function clampRate(value: unknown): number {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.min(100, Math.max(0, n));
}

function countryOf(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const code = value.trim().toUpperCase();
    return COUNTRY.test(code) ? code : null;
}

function labelOf(value: unknown): StoreTaxLabel | null {
    if (!value || typeof value !== "object") return null;
    const label = value as Record<string, unknown>;
    if (label.kind === "preset" && PRESETS.includes(label.id as StoreTaxLabelPreset)) {
        return { kind: "preset", id: label.id as StoreTaxLabelPreset };
    }
    if (label.kind === "custom" && typeof label.text === "string" && label.text.trim() !== "") {
        return { kind: "custom", text: label.text.trim().slice(0, MAX_LABEL) };
    }
    return null;
}

/**
 * What a listener answered, or the store's own answer where it answered
 * something the store cannot charge.
 *
 * A listener is another module's code. A rate of 140, a label of nothing or a
 * country of "Turkey" would reach a processor and a ledger, so the whole
 * answer falls back rather than the bad field alone: half of one answer and
 * half of another is a tax nobody configured.
 */
export function checkedAnswer(answer: unknown, fallback: StoreTaxAnswer): StoreTaxAnswer {
    if (!answer || typeof answer !== "object") return fallback;
    const raw = answer as Record<string, unknown>;
    const rate = typeof raw.rate === "number" && Number.isFinite(raw.rate) ? raw.rate : NaN;
    const label = labelOf(raw.label);
    if (!(rate >= 0 && rate <= 100) || label === null || typeof raw.included !== "boolean") return fallback;
    const reason = REASONS.includes(raw.reason as StoreTaxReason) ? (raw.reason as StoreTaxReason) : "standard";
    const evidence = raw.evidence && typeof raw.evidence === "object" ? (raw.evidence as Record<string, unknown>) : null;
    return {
        rate,
        included: raw.included,
        label,
        country: countryOf(raw.country),
        reason,
        evidence: evidence
            ? {
                  billingCountry: countryOf(evidence.billingCountry),
                  ipCountry: countryOf(evidence.ipCountry),
                  ipMasked: typeof evidence.ipMasked === "string" ? evidence.ipMasked.slice(0, 64) : null,
                  conflict: evidence.conflict === true,
              }
            : null,
    };
}

/** The name of the tax line a processor prints, with its rate. */
export function processorTaxLine(answer: Pick<StoreTaxAnswer, "label" | "rate">): string {
    const name = answer.label.kind === "custom" ? answer.label.text : PROCESSOR_NAMES[answer.label.id];
    return `${name} (${answer.rate}%)`;
}

/**
 * What the order keeps: enough to name the line on every screen that shows
 * it, and for an invoice to say why a sale carries the tax it does.
 */
export function taxRecord(answer: StoreTaxAnswer): StoreTaxRecord {
    return {
        rate: answer.rate,
        included: answer.included,
        label: answer.label,
        country: answer.country,
        reason: answer.reason,
        billingCountry: answer.evidence?.billingCountry ?? null,
        ipCountry: answer.evidence?.ipCountry ?? null,
        ipMasked: answer.evidence?.ipMasked ?? null,
        evidenceConflict: answer.evidence?.conflict ?? false,
    };
}

/** The record on an order, read back from its metadata, or null for one placed before there was one. */
export function readTaxRecord(metadata: unknown): StoreTaxRecord | null {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
    const raw = (metadata as Record<string, unknown>).tax;
    if (!raw || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    const label = labelOf(record.label);
    if (typeof record.rate !== "number" || label === null) return null;
    return {
        rate: record.rate,
        included: record.included === true,
        label,
        country: countryOf(record.country),
        reason: REASONS.includes(record.reason as StoreTaxReason) ? (record.reason as StoreTaxReason) : "standard",
        billingCountry: countryOf(record.billingCountry),
        ipCountry: countryOf(record.ipCountry),
        ipMasked: typeof record.ipMasked === "string" ? record.ipMasked : null,
        evidenceConflict: record.evidenceConflict === true,
    };
}

/** Whatever translates a key with values: `t` from next-intl on either side. */
type Say = (key: string, values?: Record<string, string | number>) => string;

const LABEL_KEYS: Record<StoreTaxLabelPreset, string> = {
    tax: "taxLabel_tax",
    vat: "taxLabel_vat",
    gst: "taxLabel_gst",
    sales_tax: "taxLabel_salesTax",
};

const REASON_KEYS: Record<StoreTaxReason, string> = {
    standard: "taxReason_standard",
    domestic: "taxReason_domestic",
    destination: "taxReason_destination",
    export: "taxReason_export",
    reverse_charge: "taxReason_reverseCharge",
    exempt: "taxReason_exempt",
};

/**
 * The tax line as a reader of this site sees it: the known name in their
 * language (VAT reads MwSt. in German and KDV in Turkish), or the operator's
 * own words, with the rate. An order from before there was a record says
 * only "Tax", because its rate was never written down.
 */
export function taxLineText(say: Say, record: StoreTaxRecord | null): string {
    if (!record) return say(LABEL_KEYS.tax);
    const label = record.label.kind === "custom" ? record.label.text : say(LABEL_KEYS[record.label.id]);
    return say(record.included ? "taxLineIncluded" : "taxLine", { label, rate: record.rate });
}

/** Why the sale carries this tax, for the operator reading the order. */
export function taxReasonText(say: Say, record: StoreTaxRecord): string {
    return say(REASON_KEYS[record.reason]);
}
