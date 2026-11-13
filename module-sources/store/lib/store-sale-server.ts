/**
 * The store-wide sales running now, read from the database, and a sale from
 * the panel's form made ready to write.
 *
 * Kept apart from `store-sale.ts` so the rule stays testable without a
 * database and the panel and the banner can import it.
 */
import { prisma, siteTimeZone } from "@/core/sdk/server";
import { effectivePrice } from "./availability";
import { saleInstant, saleRunning, withStoreSale, type StoreSale } from "./store-sale";
import { storeSaleSchema } from "./validations";

/** The columns a sale is read with, by the shop and the panel alike. */
export const STORE_SALE_SELECT = {
    id: true,
    name: true,
    percent: true,
    categoryIds: true,
    startsAt: true,
    endsAt: true,
    isActive: true,
} as const;

/**
 * Every active sale whose window holds this instant, with each one's shelves
 * widened to the shelves under them.
 *
 * Read once per request rather than per product, as campaigns are. A sale
 * named for "Ranks" means the ranks on its sub-shelves too: an operator picks
 * the shelf they see in the menu, and a sale that skipped the products filed
 * one level down would be one they find out about from a buyer.
 */
export async function runningStoreSales(at: Date): Promise<StoreSale[]> {
    const rows = await prisma.storeSale.findMany({
        where: { isActive: true, startsAt: { lte: at }, endsAt: { gt: at } },
        select: STORE_SALE_SELECT,
        orderBy: { endsAt: "asc" },
        // An operator writes these by hand; a few run at once at most.
        take: 20,
    });
    const running = rows.filter((sale) => saleRunning(sale, at));
    if (!running.some((sale) => sale.categoryIds.length > 0)) return running;

    const shelves = await prisma.category.findMany({ select: { id: true, parentId: true }, take: 2000 });
    const children = new Map<string, string[]>();
    for (const shelf of shelves) {
        if (!shelf.parentId) continue;
        children.set(shelf.parentId, [...(children.get(shelf.parentId) ?? []), shelf.id]);
    }
    const widened = (ids: string[]): string[] => {
        const seen = new Set<string>();
        const queue = [...ids];
        while (queue.length > 0) {
            const id = queue.pop() as string;
            if (seen.has(id)) continue;
            seen.add(id);
            queue.push(...(children.get(id) ?? []));
        }
        return [...seen];
    };
    return running.map((sale) => (sale.categoryIds.length === 0 ? sale : { ...sale, categoryIds: widened(sale.categoryIds) }));
}

type SaleWrite =
    | { ok: true; data: { name: string; percent: number; categoryIds: string[]; startsAt: Date; endsAt: Date; isActive: boolean } }
    | { ok: false; error: string; code?: string };

/**
 * A sale from the form, checked and with its dates as instants.
 *
 * One function for create and edit, so the two cannot accept different
 * things. An edit sends the whole form, the same as a create.
 */
export async function storeSaleWrite(body: unknown): Promise<SaleWrite> {
    const parsed = storeSaleSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const zone = await siteTimeZone();
    const startsAt = saleInstant(parsed.data.startsAt, zone);
    const endsAt = saleInstant(parsed.data.endsAt, zone);
    if (!startsAt || !endsAt || endsAt.getTime() <= startsAt.getTime()) {
        return { ok: false, error: "The sale must end after it starts", code: "store_sale_dates" };
    }
    return {
        ok: true,
        data: {
            name: parsed.data.name,
            percent: parsed.data.percent,
            categoryIds: [...new Set(parsed.data.categoryIds)],
            startsAt,
            endsAt,
            isActive: parsed.data.isActive,
        },
    };
}

/**
 * What a product is priced at before anything personal: its own sale window,
 * then a store-wide sale. The checkout starts from this, so the cart and the
 * coupon preview, which read their basket from the database rather than
 * through the checkout, start from it too.
 *
 * Reads the running sales once and answers for as many products as asked.
 */
export async function saleAdjustedPrice(at: Date): Promise<(product: {
    price: unknown;
    salePrice: unknown;
    saleFrom: Date | null;
    saleUntil: Date | null;
    categoryId: string | null;
}) => number> {
    const sales = await runningStoreSales(at);
    return (product) => {
        const listPrice = Number(product.price);
        const priced = effectivePrice(
            {
                price: listPrice,
                salePrice: product.salePrice === null || product.salePrice === undefined ? null : Number(product.salePrice),
                saleFrom: product.saleFrom,
                saleUntil: product.saleUntil,
            },
            at,
        );
        return withStoreSale(priced, { listPrice, categoryId: product.categoryId }, sales, at).price;
    };
}
