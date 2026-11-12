/**
 * What the campaign form holds, and what it sends.
 *
 * The form is a list of products with a price box beside each. An operator
 * ticks four, fills three prices and saves - and `Number("")` is 0, so the
 * fourth goes on sale for nothing. Nobody notices until the orders arrive.
 *
 * So a row without a price is not part of the campaign. Zero typed on purpose
 * still is: an operator can mean free, and the difference between meaning it
 * and leaving the box alone is exactly what this file is for.
 */
import type { LanguageTexts } from "@/core/sdk";
import { minutesFromTime } from "../products/_fields/time-of-day";

export interface CampaignEntryValue {
    productId: string;
    /** Strings, because the boxes are. Empty is "not in the campaign". */
    price: string;
    stock: string;
}

export interface CampaignFormValue {
    name: string;
    /** The name in each language, beside the original above. */
    nameLanguages: LanguageTexts;
    isActive: boolean;
    days: number[];
    from24: string;
    until24: string;
    entries: CampaignEntryValue[];
}

export const EMPTY_CAMPAIGN: CampaignFormValue = {
    name: "",
    nameLanguages: {},
    isActive: true,
    days: [],
    from24: "",
    until24: "",
    entries: [],
};

/** What the form sends. */
export function campaignPayload(value: CampaignFormValue) {
    // Last one wins: the table holds one row per product per campaign, so two
    // would be two prices with nothing to choose between them.
    const byProduct = new Map<string, { productId: string; price: number; stock: number | null }>();
    for (const entry of value.entries) {
        if (entry.price.trim() === "") continue;
        const price = Number(entry.price);
        if (!Number.isFinite(price) || price < 0) continue;
        const stock = entry.stock.trim() === "" ? null : Number(entry.stock);
        byProduct.set(entry.productId, {
            productId: entry.productId,
            price,
            stock: stock !== null && Number.isFinite(stock) && stock > 0 ? Math.floor(stock) : null,
        });
    }

    return {
        name: value.name,
        // Every time: an empty one is how a cleared language goes.
        translations: { name: value.nameLanguages },
        isActive: value.isActive,
        days: value.days,
        fromMinute: minutesFromTime(value.from24),
        untilMinute: minutesFromTime(value.until24),
        entries: [...byProduct.values()],
    };
}
