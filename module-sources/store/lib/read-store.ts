/**
 * The shop's front, read on the server.
 *
 * The store index fetched its categories and its products after the page had
 * loaded and kept the chosen category in client state. Two things followed.
 * The HTML the server sent held no link to a single product - measured, the
 * page answered with 17 links and every one of them was the shared header and
 * footer, so the 34 product URLs in the sitemap had no path into them from
 * anywhere on the site. And no category had an address at all: a section of
 * the shop could not be linked to, shared, or opened twice in a row.
 *
 * The rules about what is on the shelf are the ones the listing endpoint
 * applies, and they live here now so the two cannot disagree: switched off is
 * a filter rather than a check after the fact, and the hour of a weekly window
 * is applied in `hideShut` rather than in SQL.
 */
import { moduleSettings, prisma, siteTimeZone } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { priceAfterCredit, upgradeCredit } from "./upgrade-credit";
import { creditingPurchases } from "./upgrade-credit-server";
import { PUBLIC_PRODUCT } from "./public-product";
import { availabilityOf, effectivePrice } from "./availability";
import { pricedForCampaign, runningCampaignEntries } from "./campaign-server";
import { hideShut, onTheShelfWhere, rulesOf, type ProductRow } from "./availability-server";

export const PRODUCTS_PER_PAGE = 12;

export type StoreSort = "newest" | "price_asc" | "price_desc" | "popular";

export const STORE_SORTS: StoreSort[] = ["newest", "price_asc", "price_desc", "popular"];

export interface StoreCategory {
    id: string;
    name: string;
    slug: string;
    image: string | null;
    description: string | null;
    /** `grid` or `table`: how this shelf is drawn. */
    layout: string;
    parentId: string | null;
    children: { id: string; name: string; slug: string; image: string | null; description: string | null }[];
}

/** Every section a shopper may see, roots first with their children attached. */
export async function readStoreCategories(): Promise<StoreCategory[]> {
    const rows = await prisma.category.findMany({
        where: { isActive: true },
        orderBy: { order: "asc" },
        take: 300,
        select: {
            id: true, name: true, slug: true, image: true, description: true, layout: true, parentId: true,
            children: {
                where: { isActive: true },
                orderBy: { order: "asc" },
                select: { id: true, name: true, slug: true, image: true, description: true },
            },
        },
    });
    return rows;
}

/**
 * One product as a shelf draws it.
 *
 * Named, and built field by field rather than spread from the row, because
 * this crosses into a Client Component. `price` was already a number - the
 * window works it out - but `comparePrice` and `salePrice` came straight off
 * Prisma as `Decimal`, and React refuses to serialise one: every visit to a
 * category threw "Only plain objects can be passed to Client Components".
 *
 * It went unnoticed because the page handed the row over as `as never`, which
 * is a cast that agrees with anything. `readProduct` had already converted the
 * same two columns for the same reason; the listing had not.
 */
export interface ShelfProduct {
    id: string;
    number: number;
    name: string;
    slug: string;
    /** What this reader pays: the credit for what they own is already off it. */
    price: number;
    /** Taken off because they already own a cheaper rung. Zero for most people. */
    upgradeCredit: number;
    /** What it costs somebody who owns nothing on this shelf. */
    fullPrice: number;
    comparePrice: number | null;
    was: number | null;
    onSale: boolean;
    image: string | null;
    stock: number | null;
    isFeatured: boolean;
    category: { id: string; name: string; slug: string } | null;
    availability: {
        state: string;
        buyable: boolean;
        opensAt: string | null;
        closesAt: string | null;
        restricted: boolean;
    };
}

export interface StoreProducts {
    products: ShelfProduct[];
    lowStockAt: number;
    page: number;
    pages: number;
    total: number;
}

/**
 * One page of products, annotated the way the card expects.
 *
 * Almost nobody in particular: no per-person limit counting and no rank gate,
 * because those hide things and the shelf is the same list for everybody.
 *
 * The price is not the same for everybody. A shop selling a ladder makes a
 * different offer to somebody standing on it - pay the difference - and that
 * offer was invisible until the checkout took the money: the card said 19.99
 * and the charge was 10.00. A price nobody can see before they commit is not
 * an offer.
 */
export async function readStoreProducts(options: {
    categorySlug?: string;
    search?: string;
    sort: StoreSort;
    page: number;
}): Promise<StoreProducts> {
    const now = new Date();
    const page = Math.max(1, Math.floor(options.page) || 1);
    const where = {
        ...onTheShelfWhere(now),
        ...(options.categorySlug ? { category: { slug: options.categorySlug } } : {}),
        ...(options.search
            ? {
                OR: [
                    { name: { contains: options.search, mode: "insensitive" as const } },
                    { description: { contains: options.search, mode: "insensitive" as const } },
                ],
            }
            : {}),
    };

    const [products, total] = await Promise.all([
        prisma.product.findMany({
            where,
            select: PUBLIC_PRODUCT,
            skip: (page - 1) * PRODUCTS_PER_PAGE,
            take: PRODUCTS_PER_PAGE,
            orderBy: options.sort === "popular" ? [{ unitsSold: "desc" as const }, { createdAt: "desc" as const }]
                : options.sort === "price_asc" ? { price: "asc" as const }
                : options.sort === "price_desc" ? { price: "desc" as const }
                : { createdAt: "desc" as const },
        }),
        prisma.product.count({ where }),
    ]);

    const zone = await siteTimeZone();
    // Once for the whole page: a shop runs few campaigns, and asking each
    // product for its entry would be a query a line.
    const campaignEntries = await runningCampaignEntries(prisma, now, zone);
    const { lowStockAt } = await moduleSettings<{ lowStockAt: number }>("store");

    // Once for the page: empty for a visitor, and for a shop that has turned
    // the credit off.
    const session = await auth();
    const ownedIds = await creditingPurchases(session?.user?.id);

    const visible = hideShut(products as unknown as ProductRow[], now, zone);
    // The rungs of every ladder on this page, priced the way the cards are.
    // A credit is worked out against what is on the shelf, so it is the same
    // list the reader is looking at.
    const ladder = visible.map((other) => ({
        id: other.id,
        categoryId: (other as unknown as { category: { id: string } | null }).category?.id ?? null,
        price: pricedForCampaign(other.id, effectivePrice(rulesOf(other), now), campaignEntries).price,
    }));

    const annotated: ShelfProduct[] = visible.map((row) => {
        const rules = rulesOf(row);
        const state = availabilityOf({ ...rules, roleIds: [] }, { boughtByPerson: 0, soldInPeriod: 0 }, now, zone);
        const priced = pricedForCampaign(row.id, effectivePrice(rules, now), campaignEntries);
        const credit = upgradeCredit(
            {
                id: row.id,
                categoryId: (row as unknown as { category: { id: string } | null }).category?.id ?? null,
                price: priced.price,
            },
            ladder,
            ownedIds,
        );
        const source = row as unknown as {
            id: string; number: number; name: string; slug: string;
            comparePrice: unknown; image: string | null; stock: number | null; isFeatured: boolean;
            category: { id: string; name: string; slug: string } | null;
        };
        return {
            id: source.id,
            number: source.number,
            name: source.name,
            slug: source.slug,
            price: priceAfterCredit(priced.price, credit),
            upgradeCredit: credit,
            fullPrice: priced.price,
            comparePrice: source.comparePrice === null ? null : Number(source.comparePrice),
            was: priced.was,
            onSale: priced.onSale,
            image: source.image,
            stock: source.stock,
            isFeatured: source.isFeatured,
            category: source.category,
            availability: {
                state: state.state,
                buyable: state.buyable,
                opensAt: state.opensAt ? state.opensAt.toISOString() : null,
                closesAt: state.closesAt ? state.closesAt.toISOString() : null,
                restricted: row.roleIds.length > 0,
            },
        };
    });

    return {
        products: annotated,
        lowStockAt,
        page,
        pages: Math.max(1, Math.ceil(total / PRODUCTS_PER_PAGE)),
        total,
    };
}
