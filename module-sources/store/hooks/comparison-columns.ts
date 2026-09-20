/**
 * Answers `comparison.columns`: the products on one shelf, ready to be drawn
 * as the columns of a comparison.
 *
 * Everything visible comes from here at the moment the page is drawn - the
 * name, the price the availability window worked out, the picture, the way to
 * buy - so a table cannot go stale. Before this, a column was a label an
 * operator typed and a URL beside it, and the seeded table proved what that
 * costs: its columns read Free, VIP and Gold while the shop sold VIP, VIP+,
 * MVP, MVP+ and Legend.
 *
 * The same rules the shelf itself applies: a switched-off product is not a
 * column, and one whose window is shut is hidden exactly as it is on the grid.
 * A table is a way of drawing a category, not a way around it.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { getTranslations } from "next-intl/server";
import { moduleSettings, prisma, siteTimeZone } from "@/core/sdk/server";
import { PUBLIC_PRODUCT } from "../lib/public-product";
import { effectivePrice } from "../lib/availability";
import { pricedForCampaign, runningCampaignEntries } from "../lib/campaign-server";
import { hideShut, onTheShelfWhere, rulesOf, type ProductRow } from "../lib/availability-server";
import { categoryIdIn } from "../lib/comparison-subject";

/** How many products one shelf may put in a table before it stops being one. */
const MOST_COLUMNS = 12;

const columns: HookHandlerFor<"comparison.columns", "filter"> = async (current, who) => {
    const categoryId = who?.subjectRef ? categoryIdIn(who.subjectRef) : null;
    if (!categoryId) return current;

    const now = new Date();
    const rows = await prisma.product.findMany({
        where: { ...onTheShelfWhere(now), categoryId },
        select: PUBLIC_PRODUCT,
        orderBy: [{ price: "asc" }, { createdAt: "asc" }],
        take: MOST_COLUMNS,
    });

    const zone = await siteTimeZone();
    const campaignEntries = await runningCampaignEntries(prisma, now, zone);
    const { lowStockAt } = await moduleSettings<{ lowStockAt: number }>("store");

    const visible = hideShut(rows as unknown as ProductRow[], now, zone);

    // The reader's own language: this runs from an API route with no locale in
    // its path, so without being told it answers in the default and a Turkish
    // shopper was shown an English line under the price.
    const t = who?.locale
        ? await getTranslations({ locale: who.locale, namespace: "store" })
        : await getTranslations("store");

    // At most one column is emphasised. "Featured" is the operator's existing
    // mark for the one they want chosen, and a shop that has featured three
    // of five ranks has emphasised nothing - the cheapest of them is the one
    // a ladder points at.
    const emphasised = visible.find((row) => (row as unknown as { isFeatured: boolean }).isFeatured)?.id ?? null;

    return [
        ...current,
        ...visible.map((row) => {
            const source = row as unknown as {
                id: string; number: number; name: string; slug: string;
                stock: number | null; image: string | null; isFeatured: boolean;
                comparePrice: unknown;
            };
            const priced = pricedForCampaign(row.id, effectivePrice(rulesOf(row), now), campaignEntries);
            // The struck-through figure the card already shows. `effectivePrice`
            // only knows about a sale window; a plain compare-at price is the
            // other half of it, and a table without it prices a rank lower than
            // the card beside it does.
            const compareAt = source.comparePrice === null ? null : Number(source.comparePrice);
            const was = priced.was ?? (compareAt !== null && compareAt > priced.price ? compareAt : null);
            const path = `/store/product/${source.number}/${source.slug}`;
            const low = typeof lowStockAt === "number" && lowStockAt > 0
                && source.stock !== null && source.stock > 0 && source.stock <= lowStockAt;

            return {
                ref: source.id,
                label: source.name,
                image: source.image,
                price: priced.price,
                was,
                fullPrice: priced.price,
                // One line under the price. Written here rather than in the
                // table, because the shop is what knows the words for its own
                // shelves.
                note: low ? t("leftInStock", { count: Number(source.stock) }) : null,
                href: path,
                buyHref: path,
                // Cheapest first, so the ladder reads upward.
                highlight: source.id === emphasised,
            };
        }),
    ];
};

export default columns;
