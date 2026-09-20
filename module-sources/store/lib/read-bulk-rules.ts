import { prisma } from "@/core/sdk/server";
import { bulkLadder, type BulkRung, type PricingBulkDiscount } from "./pricing";

/**
 * The rules a shopper is standing in front of.
 *
 * The table had one reader, the till, so the shelf and the product page both
 * quoted the list price and the discount appeared for the first time on the
 * receipt. A discount nobody is told about sells nothing extra, which is the
 * whole purpose of one.
 *
 * The live ones only: a rule an operator has switched off is not an offer.
 * The ceiling matches the endpoint's, and for the same reason - an operator
 * writes these by hand, so five hundred is a number nobody reaches, and a
 * truncated answer beats an unbounded read.
 */
export async function readBulkRules(): Promise<PricingBulkDiscount[]> {
    return prisma.bulkDiscount.findMany({
        where: { isActive: true },
        take: 500,
        select: { minQuantity: true, discountPercent: true, productIds: true, categoryIds: true },
    });
}

/** The ladder for one product, read and worked out in one call. */
export async function readBulkLadder(product: {
    id: string;
    categoryId?: string | null;
}): Promise<BulkRung[]> {
    return bulkLadder(await readBulkRules(), product);
}
