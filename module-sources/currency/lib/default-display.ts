/**
 * What a currency from the list is worth against the site's own base, and
 * which one a visitor who never picked should read.
 *
 * The list is quoted against its own base, which need not be the currency
 * the site charges in, so every display rate goes through the site's base:
 * the target's rate over the base's. Picking from the footer, the operator's
 * default and a stored pick brought up to today's rate all go through
 * `quote`, so the three cannot disagree about what a lira is worth.
 *
 * Guarded by `a-new-visitor-sees-the-operators-currency`.
 */

interface ListedCurrency {
    code: string;
    rate: number;
    enabled?: boolean;
}

export interface DisplaySettings {
    currencies: ListedCurrency[];
    /** The currency a visitor with no pick reads; empty or missing is the base. */
    defaultDisplay?: string;
    /** The same, per language the page is read in; wins over `defaultDisplay`. */
    languageDisplay?: Record<string, string>;
}

/** The currencies a visitor may be shown: switched on, with a usable rate. */
export function offered(settings: DisplaySettings): ListedCurrency[] {
    return (settings.currencies ?? []).filter((c) => c.enabled !== false && c.rate > 0);
}

/** `code` as core takes it, or null when it or the site's base is not offered. */
export function quote(settings: DisplaySettings, code: string, siteBase: string): { code: string; rate: number } | null {
    const list = offered(settings);
    const baseRate = list.find((c) => c.code === siteBase)?.rate;
    const target = list.find((c) => c.code === code);
    if (!baseRate || !target) return null;
    return { code: target.code, rate: target.rate / baseRate };
}

/** The default for a visitor reading in `locale`, or null for the base. */
export function defaultDisplayFor(settings: DisplaySettings, locale: string, siteBase: string): { code: string; rate: number } | null {
    const wanted = settings.languageDisplay?.[locale] || settings.defaultDisplay || "";
    if (wanted === "" || wanted === siteBase) return null;
    return quote(settings, wanted, siteBase);
}
