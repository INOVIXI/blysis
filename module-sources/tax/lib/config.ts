/**
 * Where the tax settings live, and how a sale's buyer is read from what the
 * store hands over.
 *
 * One site setting holds the whole configuration, because the country table
 * is a map an operator edits as a whole and the generic module settings form
 * has no shape for one, nor a way to say anything in a language other than
 * English.
 */
import { applyFiltersAsync } from "@/core/sdk";
import { moduleSettings, prisma } from "@/core/sdk/server";
import { DEFAULT_CONFIG, countryCode, maskIp, readConfig, type Buyer, type TaxConfig } from "./rules";

export const CONFIG_KEY = "tax_config";

/**
 * The saved settings, or null before the operator first saves the screen.
 *
 * Null is an answer: installing the module changes nothing until somebody
 * has looked at its screen, and the store keeps charging its own rate.
 */
export async function readTaxConfig(): Promise<TaxConfig | null> {
    const row = await prisma.setting.findUnique({ where: { key: CONFIG_KEY } });
    return row ? readConfig(row.value) : null;
}

/**
 * What the screen starts from before anything is saved: the store's own rate
 * and switch, so saving it unchanged charges what the shop charged before.
 */
export async function startingConfig(): Promise<TaxConfig> {
    const store = await moduleSettings<{ taxRate?: number; taxIncluded?: boolean }>("store");
    return readConfig({ ...DEFAULT_CONFIG, defaultRate: store.taxRate ?? 0, pricesIncludeTax: store.taxIncluded === true });
}

/**
 * The country the buyer's connection comes from, or null.
 *
 * A CDN's header first, and only where the operator said the site is behind
 * one: anybody can send `CF-IPCountry` to a site that is not, so trusting it
 * by default would let a buyer pick their own rate. Then whatever answers the
 * `geo.country` filter, which nothing does until a module that looks addresses
 * up is installed - a paid lookup is never made by default.
 */
export async function ipCountryOf(config: TaxConfig, context: StoreTaxContext): Promise<string | null> {
    if (config.trustCountryHeader) {
        const fromHeader = countryCode(context.header(config.countryHeader));
        if (fromHeader) return fromHeader;
    }
    if (!context.ip) return null;
    return countryCode(await applyFiltersAsync("geo.country", null, { ip: context.ip }));
}

/** The buyer as the rules read them. */
export async function buyerOf(config: TaxConfig, context: StoreTaxContext): Promise<Buyer> {
    return {
        billingCountry: context.billing?.country ?? null,
        kind: context.billing?.kind ?? null,
        taxNumber: context.billing?.taxNumber ?? "",
        ipCountry: await ipCountryOf(config, context),
        ipMasked: maskIp(context.ip),
    };
}
