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

export interface StoreProducts {
    products: unknown[];
    lowStockAt: number;
    page: number;
    pages: number;
    total: number;
}

/**
 * One page of products, annotated the way the card expects.
 *
 * Nobody in particular: no per-person counting and no rank, because the same
 * answer is drawn for every reader. The product page, which knows who is
 * asking, says the rest.
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

    const annotated = hideShut(products as unknown as ProductRow[], now, zone).map((row) => {
        const rules = rulesOf(row);
        const state = availabilityOf({ ...rules, roleIds: [] }, { boughtByPerson: 0, soldInPeriod: 0 }, now, zone);
        return {
            ...row,
            availability: {
                state: state.state,
                buyable: state.buyable,
                opensAt: state.opensAt ? state.opensAt.toISOString() : null,
                closesAt: state.closesAt ? state.closesAt.toISOString() : null,
                restricted: row.roleIds.length > 0,
            },
            ...pricedForCampaign(row.id, effectivePrice(rules, now), campaignEntries),
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
