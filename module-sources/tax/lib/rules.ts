/**
 * Which tax a sale carries, as plain arithmetic over the operator's settings.
 *
 * The store asks the `store.tax` filter for every sale and this answers it.
 * Nothing here reads a request, a database or a clock, so every rule an
 * operator can set is tested by handing it numbers.
 *
 * The rules, in the order they are asked:
 *
 *   1. Where the buyer is. The billing address when the buyer gave one, the
 *      country their connection comes from otherwise; both are kept as
 *      evidence, and a disagreement between them is flagged rather than
 *      settled, because deciding which one is lying is a person's job.
 *   2. A buyer in the seller's own country, or a shop that has not said where
 *      it is, pays the rate for that country from the table, or the default.
 *   3. A buyer in another country the table names - a tax area such as the
 *      EU, where a seller charges the buyer's country's rate - pays that
 *      country's rate, unless they are a company that gave a tax number and
 *      the operator applies the reverse charge, in which case the buyer
 *      accounts for the tax and none is charged.
 *   4. A buyer in a country the table does not name is outside the tax area:
 *      zero-rated as an export where the operator says so, the default rate
 *      otherwise.
 *
 * Every answer says which of those happened, so an invoice can carry the
 * reason a foreign or zero-rated sale has no tax on it.
 */

export const LABEL_PRESETS = ["tax", "vat", "gst", "sales_tax"] as const;
export type LabelPreset = (typeof LABEL_PRESETS)[number];

/** What a buyer outside every country in the table is charged. */
export type OutsideArea = "default" | "zero";

export interface TaxConfig {
    /** Whether the prices on the shelf already contain the tax. */
    pricesIncludeTax: boolean;
    /** Percent. Applied where nothing more specific does. */
    defaultRate: number;
    /** A known name, translated where the site is read, or "custom". */
    labelPreset: LabelPreset | "custom";
    /** The operator's own name for the tax, when `labelPreset` is "custom". */
    labelText: string;
    /** ISO 3166-1 alpha-2, uppercase; empty when the operator has not said. */
    sellerCountry: string;
    /** ISO 3166-1 alpha-2 to percent: the countries whose own rate is charged. */
    countryRates: Record<string, number>;
    outsideArea: OutsideArea;
    /** Zero-rate a company in another country of the table that gave a tax number. */
    reverseCharge: boolean;
    /** Ask every buyer for a billing address, so the rule has a country to go on. */
    requireBillingAddress: boolean;
    /** Read the visitor's country from a header a CDN in front of the site sets. */
    trustCountryHeader: boolean;
    /** Which header, e.g. `cf-ipcountry`. */
    countryHeader: string;
}

export const DEFAULT_CONFIG: TaxConfig = {
    pricesIncludeTax: false,
    defaultRate: 0,
    labelPreset: "tax",
    labelText: "",
    sellerCountry: "",
    countryRates: {},
    outsideArea: "default",
    reverseCharge: false,
    requireBillingAddress: false,
    trustCountryHeader: false,
    countryHeader: "cf-ipcountry",
};

const COUNTRY = /^[A-Z]{2}$/;
const HEADER = /^[a-z0-9-]{1,64}$/;
const MAX_LABEL = 40;

/**
 * A country code, or null.
 *
 * Two-letter codes that name no country are refused as well as malformed
 * ones: Cloudflare sends `XX` when it does not know and `T1` for Tor, and
 * either taken as a country would charge a rate for a place nobody is in.
 */
export function countryCode(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const code = value.trim().toUpperCase();
    if (!COUNTRY.test(code) || code === "XX" || code === "T1" || code === "ZZ") return null;
    return code;
}

function percent(value: unknown, fallback = 0): number {
    const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
    return Math.min(100, Math.max(0, n));
}

/**
 * The stored configuration, with anything it cannot use replaced.
 *
 * It is a JSON value a hand edit or a restore may have written, so every
 * field is read rather than trusted: a rate outside 0 to 100 is clamped, a
 * country that is not a code is dropped.
 */
export function readConfig(value: unknown): TaxConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_CONFIG, countryRates: {} };
    const raw = value as Record<string, unknown>;
    const rates: Record<string, number> = {};
    if (raw.countryRates && typeof raw.countryRates === "object" && !Array.isArray(raw.countryRates)) {
        for (const [key, rate] of Object.entries(raw.countryRates as Record<string, unknown>)) {
            const code = countryCode(key);
            if (code) rates[code] = percent(rate);
        }
    }
    const preset = raw.labelPreset;
    const header = typeof raw.countryHeader === "string" ? raw.countryHeader.trim().toLowerCase() : "";
    return {
        pricesIncludeTax: raw.pricesIncludeTax === true,
        defaultRate: percent(raw.defaultRate),
        labelPreset:
            preset === "custom" || (LABEL_PRESETS as readonly unknown[]).includes(preset)
                ? (preset as LabelPreset | "custom")
                : "tax",
        labelText: typeof raw.labelText === "string" ? raw.labelText.trim().slice(0, MAX_LABEL) : "",
        sellerCountry: countryCode(raw.sellerCountry) ?? "",
        countryRates: rates,
        outsideArea: raw.outsideArea === "zero" ? "zero" : "default",
        reverseCharge: raw.reverseCharge === true,
        requireBillingAddress: raw.requireBillingAddress === true,
        trustCountryHeader: raw.trustCountryHeader === true,
        countryHeader: HEADER.test(header) ? header : DEFAULT_CONFIG.countryHeader,
    };
}

/** The label the answer carries: a preset id, or the operator's text. */
export function labelOf(config: TaxConfig): StoreTaxLabel {
    if (config.labelPreset === "custom" && config.labelText !== "") return { kind: "custom", text: config.labelText };
    return { kind: "preset", id: config.labelPreset === "custom" ? "tax" : config.labelPreset };
}

/**
 * An address cut to its network, for evidence that is not a fingerprint.
 *
 * Where a buyer was matters for a tax return; which machine they used does
 * not, and the full address is personal data nobody here needs. IPv4 keeps
 * its first three parts, IPv6 its first three groups.
 */
export function maskIp(ip: string | null | undefined): string | null {
    if (!ip) return null;
    const value = ip.trim();
    const v4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
    if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`;
    if (value.includes(":")) {
        const groups = value.split(":");
        if (groups.length < 3) return null;
        return `${groups.slice(0, 3).map((g) => g || "0").join(":")}::`;
    }
    return null;
}

/** Who is buying and from where, as the store and the request tell it. */
export interface Buyer {
    billingCountry: string | null;
    /** Company or individual, as the billing form says. */
    kind: "individual" | "company" | null;
    taxNumber: string;
    ipCountry: string | null;
    ipMasked: string | null;
}

/** The whole answer for one sale. */
export function taxFor(config: TaxConfig, buyer: Buyer): StoreTaxAnswer {
    const billingCountry = countryCode(buyer.billingCountry);
    const ipCountry = countryCode(buyer.ipCountry);
    const country = billingCountry ?? ipCountry;
    const evidence: StoreTaxEvidence = {
        billingCountry,
        ipCountry,
        ipMasked: buyer.ipMasked,
        conflict: billingCountry !== null && ipCountry !== null && billingCountry !== ipCountry,
    };
    const answer = (rate: number, reason: StoreTaxReason): StoreTaxAnswer => ({
        rate,
        included: config.pricesIncludeTax,
        label: labelOf(config),
        country,
        reason: rate === 0 && (reason === "standard" || reason === "domestic") ? "exempt" : reason,
        evidence,
    });

    const seller = config.sellerCountry || null;
    const ownRate = country !== null ? config.countryRates[country] : undefined;

    if (country === null) return answer(config.defaultRate, "standard");
    if (seller === null || country === seller) {
        return answer(ownRate ?? config.defaultRate, seller === null ? "standard" : "domestic");
    }
    if (ownRate !== undefined) {
        const company = buyer.kind === "company" && buyer.taxNumber.trim() !== "";
        if (config.reverseCharge && company) return answer(0, "reverse_charge");
        return answer(ownRate, "destination");
    }
    if (config.outsideArea === "zero") return answer(0, "export");
    return answer(config.defaultRate, "standard");
}

/**
 * The standard VAT rate of each EU member state, for the button that fills
 * the table. Rates change; the screen says to check them before saving, and
 * these are what the operator starts from, not what anything enforces.
 */
export const EU_STANDARD_RATES: Readonly<Record<string, number>> = {
    AT: 20, BE: 21, BG: 20, CY: 19, CZ: 21, DE: 19, DK: 25, EE: 24, ES: 21,
    FI: 25.5, FR: 20, GR: 24, HR: 25, HU: 27, IE: 23, IT: 22, LT: 21, LU: 17,
    LV: 21, MT: 18, NL: 21, PL: 23, PT: 23, RO: 21, SE: 25, SI: 22, SK: 23,
};
