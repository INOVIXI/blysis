/**
 * A store-wide sale: a percentage off every product, or off chosen shelves,
 * between two instants.
 *
 * The shop already had two ways to make something cheaper for a while: a
 * product's own sale price with a window, and a campaign that moves named
 * products to named prices. Neither says "everything is 20% off this
 * weekend" without an operator typing a price for every product. This is the
 * one number for that.
 *
 * Pure and free of the database, so the panel, the banner and the till all
 * read the same rule. The rows are read in `store-sale-server.ts`.
 */
import { wallClockToInstant } from "@/core/sdk";

/** A sale as the store reads it. */
export interface StoreSale {
    id: string;
    name: string;
    /** Whole percent off the list price. */
    percent: number;
    /** Shelves it covers. Empty is the whole store. */
    categoryIds: string[];
    startsAt: Date;
    /** The first instant it no longer applies. */
    endsAt: Date;
    isActive: boolean;
}

/** What a product costs right now, as every screen and the till carry it. */
export interface PricedNow {
    price: number;
    was: number | null;
    onSale: boolean;
}

export const MIN_SALE_PERCENT = 1;
/**
 * The most a sale may take off. A typo of 100 would give the shop away, and
 * a price of zero sends nothing to a gateway, so the ceiling is below it.
 */
export const MAX_SALE_PERCENT = 90;

const cents = (amount: number): number => Math.round(amount * 100) / 100;

/** Whether the sale applies at this instant. The end is not included. */
export function saleRunning(sale: Pick<StoreSale, "isActive" | "startsAt" | "endsAt">, at: Date): boolean {
    if (!sale.isActive) return false;
    const now = at.getTime();
    return sale.startsAt.getTime() <= now && now < sale.endsAt.getTime();
}

/**
 * The percent a product on this shelf gets: the largest of the running sales
 * that cover it, or zero.
 *
 * Two sales covering one product is an operator's decision that two offers
 * overlap, and the buyer gets the better one. They are never added together:
 * a 20% weekend and a 10% shelf sale are not 30% off.
 */
export function salePercentFor(sales: readonly StoreSale[], categoryId: string | null | undefined, at: Date): number {
    let best = 0;
    for (const sale of sales) {
        if (!saleRunning(sale, at)) continue;
        const covers = sale.categoryIds.length === 0 || (categoryId != null && sale.categoryIds.includes(categoryId));
        if (!covers) continue;
        const percent = Math.min(MAX_SALE_PERCENT, Math.max(0, Math.floor(sale.percent)));
        if (percent > best) best = percent;
    }
    return best;
}

/**
 * What a product costs once a store-wide sale is applied.
 *
 * The precedence, and why:
 *
 * - The sale takes its percent off the product's ordinary list price, never
 *   off a price that is already reduced. Off a reduced price it would stack,
 *   and an operator setting "20% off" does not mean 20% off a price that a
 *   product sale has already cut by half.
 * - The buyer pays the lower of that and whatever the product already costs
 *   right now: its own sale price, or a campaign's price. Whichever offer is
 *   better wins and the other does nothing. A store sale must never make
 *   something dearer than it was a minute before it started.
 * - The struck-through figure is the list price, because that is what the
 *   percent was taken from.
 * - Bulk discounts, upgrade credit, coupons and creator codes are not here:
 *   they apply afterwards, to this price, as they already did to a product's
 *   own sale price.
 *
 * Rounded to the cent, as every amount in `pricing.ts` is, so the figure on
 * the card is the figure the gateway is asked for.
 * `tests/modules/store/a-store-wide-sale-is-the-price-taken.test.ts` holds it.
 */
export function withStoreSale(
    priced: PricedNow,
    product: { listPrice: number; categoryId: string | null | undefined },
    sales: readonly StoreSale[],
    at: Date,
): PricedNow {
    if (sales.length === 0) return priced;
    const percent = salePercentFor(sales, product.categoryId, at);
    if (percent <= 0 || !(product.listPrice > 0)) return priced;
    const reduced = cents(product.listPrice * (1 - percent / 100));
    if (reduced >= priced.price) return priced;
    return { price: reduced, was: product.listPrice, onSale: true };
}

/**
 * A date from the form as an instant.
 *
 * The form sends the wall clock, "2026-11-20T18:00", meaning that hour where
 * the shop is; an API caller may send an instant with its offset instead.
 * Both are accepted. Null when it is neither.
 */
export function saleInstant(value: string, zone: string): Date | null {
    if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value)) {
        const at = new Date(value);
        return Number.isNaN(at.getTime()) ? null : at;
    }
    return wallClockToInstant(value, zone);
}

/** The state a sale is in, as the panel names it. */
export function saleState(sale: Pick<StoreSale, "isActive" | "startsAt" | "endsAt">, at: Date): "off" | "running" | "scheduled" | "ended" {
    if (!sale.isActive) return "off";
    if (saleRunning(sale, at)) return "running";
    return sale.startsAt.getTime() > at.getTime() ? "scheduled" : "ended";
}
