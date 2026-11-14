/**
 * The campaign a shop is running right now, if any, as prices.
 *
 * Read once per listing rather than per product: a shop runs few campaigns and
 * asking for each product's entry separately would be a query a line. The
 * answer is the same for everybody, so it stays cacheable alongside the rest
 * of the listing - a campaign is announced, not hidden.
 */
import { effectivePrice, type ProductRules } from "./availability";
import { campaignIsRunning, campaignPriceFor, type CampaignEntry } from "./campaign";

interface CampaignReader {
    campaign: {
        findMany(args: {
            where: { isActive: true };
            select: {
                isActive: true;
                days: true;
                fromMinute: true;
                untilMinute: true;
                entries: { select: { productId: true; price: true; stock: true } };
            };
            take: number;
        }): Promise<{
            isActive: boolean;
            days: number[];
            fromMinute: number | null;
            untilMinute: number | null;
            entries: { productId: string; price: unknown; stock: number | null }[];
        }[]>;
    };
}

/**
 * Every entry from every campaign open at this moment.
 *
 * Two campaigns listing one product is an operator's decision that the two
 * offers overlap, and the buyer gets the better of them: `campaignPriceFor`
 * takes the lowest, so the order the rows arrive in cannot change a price.
 */
export async function runningCampaignEntries(
    db: CampaignReader,
    now: Date,
    zone: string,
): Promise<CampaignEntry[]> {
    const campaigns = await db.campaign.findMany({
        where: { isActive: true },
        // On the hot path: every product listing asks this. Switched-on
        // campaigns are few by nature, and a shop that has left fifty running
        // has a different problem - but the listing must not get slower with
        // every one an operator forgot to switch off.
        take: 50,
        select: {
            isActive: true,
            days: true,
            fromMinute: true,
            untilMinute: true,
            entries: { select: { productId: true, price: true, stock: true } },
        },
    });

    return campaigns
        .filter((campaign) => campaignIsRunning(campaign, now, zone))
        .flatMap((campaign) =>
            campaign.entries.map((entry) => ({
                productId: entry.productId,
                price: Number(entry.price),
            })),
        );
}

/**
 * What a product costs right now, before anything personal: the lowest of its
 * list price, its own sale price inside the sale's window, and the price of
 * any campaign running now.
 *
 * Every screen that quotes a price and both tills that take one ask this one
 * function - the listing, the product page, the comparison table, the in-game
 * catalogue, the checkout and a purchase in game - and so does the upgrade
 * credit for the rung a buyer owns. The listing used to apply the campaign
 * and the checkout did not, so a card that said 60 was charged at 100.
 * `tests/modules/store/a-campaign-price-is-the-price-taken.test.ts` holds the
 * shelf and the till together.
 *
 * A campaign entry's stock figure is not read here. Nothing counts what has
 * sold at a campaign price, so no screen can say when the figure is reached,
 * and a till that stopped at it on its own would charge more than the card
 * showed. The figure and its count belong together, at the shelf and the
 * till at once.
 *
 * Upgrade credit, bulk discounts, coupons and creator codes apply afterwards,
 * to this price.
 */
export function offerPrice(
    product: { id: string } & Pick<ProductRules, "price" | "salePrice" | "saleFrom" | "saleUntil">,
    entries: CampaignEntry[],
    now: Date,
): { price: number; was: number | null; onSale: boolean } {
    return pricedForCampaign(product.id, effectivePrice(product, now), entries);
}

/** The price a product is listed at, once any running campaign is applied. */
function pricedForCampaign(
    productId: string,
    priced: { price: number; was: number | null; onSale: boolean },
    entries: CampaignEntry[],
): { price: number; was: number | null; onSale: boolean } {
    if (entries.length === 0) return priced;
    const price = campaignPriceFor(productId, priced.price, entries);
    if (price === priced.price) return priced;
    // The struck-through figure stays whatever it already was, or becomes the
    // ordinary price: a shopper compares against what they would have paid a
    // minute ago, not against a list price nobody was charging.
    return { price, was: priced.was ?? priced.price, onSale: true };
}
