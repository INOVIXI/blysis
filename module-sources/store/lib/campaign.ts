/**
 * A campaign: one price change, many products, opening and closing by itself.
 *
 * Every rule a campaign needs already exists per product - a weekly window, a
 * sale price, an allowance that refills - and setting them ten times by hand
 * is how a shop ends up with nine products on offer and one that was missed,
 * and then with nine that never came off. The campaign is the missing noun:
 * name it once, list what is in it, and it turns itself on and off.
 *
 * It borrows the product's own window rule rather than repeating it. Two
 * implementations of "does this wrap past midnight" is one of them shutting a
 * shop in the middle of its own event.
 */
import { zonedNow } from "@/core/sdk";
import { insideWeeklyWindow } from "./availability";

/** When a campaign runs, as the operator sets it. */
export interface CampaignHours {
    isActive: boolean;
    /** Weekdays it runs on, 0 is Sunday. Empty means every day. */
    days: number[];
    /** Minutes past midnight on the site's clock. Null means all day. */
    fromMinute: number | null;
    untilMinute: number | null;
}

/** One product's place in a campaign. */
export interface CampaignEntry {
    productId: string;
    price: number;
}

/** Whether the campaign is open right now, on the site's clock. */
export function campaignIsRunning(hours: CampaignHours, at: Date, zone: string): boolean {
    if (!hours.isActive) return false;
    const { weekday, minutes } = zonedNow(at, zone);
    return insideWeeklyWindow(weekday, minutes, hours.days, hours.fromMinute, hours.untilMinute);
}

/**
 * What a product costs while a campaign is running.
 *
 * The buyer pays the lower of the two. A campaign is meant to be an offer, and
 * charging somebody more than the price already on the page because an event
 * started is the opposite of one - which is easy to do by accident when a
 * product is on its own sale and somebody sets the campaign from the list
 * price.
 *
 * Two campaigns listing the product give the lower of their two prices.
 *
 * Zero is a price an operator can mean; a negative one and a number that is
 * not a number are not, and are ignored rather than charged.
 */
export function campaignPriceFor(
    productId: string,
    ordinaryPrice: number,
    entries: CampaignEntry[],
): number {
    // Every entry for the product, not the first: two campaigns open at once
    // over one product are two offers, and the order the rows arrive in must
    // not decide which one the buyer gets.
    return entries
        .filter((entry) => entry.productId === productId && Number.isFinite(entry.price) && entry.price >= 0)
        .reduce((best, entry) => Math.min(best, entry.price), ordinaryPrice);
}
