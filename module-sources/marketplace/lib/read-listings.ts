/**
 * One page of what is for sale, read on the server.
 *
 * The page fetched it after it had loaded, so the HTML the server sent carried
 * no listing, no title and no price: measured, 91 characters of text inside
 * `<main>`. The endpoint calls this too, so what counts as on sale - active
 * and unsold - is decided once.
 */
import { prisma } from "@/core/sdk/server";

export const LISTINGS_PER_PAGE = 24;

export async function readListings(page = 1, perPage = LISTINGS_PER_PAGE) {
    const at = Math.max(1, Math.floor(page) || 1);
    const where = { isActive: true, isSold: false };

    const [listings, total] = await Promise.all([
        prisma.marketListing.findMany({
            where,
            include: { seller: { select: { id: true, username: true, avatar: true } } },
            orderBy: { createdAt: "desc" },
            skip: (at - 1) * perPage,
            take: perPage,
        }),
        prisma.marketListing.count({ where }),
    ]);

    return { listings, total, page: at, pages: Math.max(1, Math.ceil(total / perPage)) };
}
