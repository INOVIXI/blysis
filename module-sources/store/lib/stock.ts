/**
 * Taking a limited product off the shelf, and putting it back.
 *
 * `Product.stock` is edited on the admin form, rendered on the product page and
 * checked when an item goes into a cart, and until this file existed nothing
 * ever subtracted from it: a shop with one of something sold it to everyone who
 * asked. `null` means the shop does not count that product, and a null is never
 * written to - the difference between "unlimited" and "none left" is the whole
 * meaning of the column.
 *
 * The take is a conditional update rather than a read and a write, for the
 * reason the credit balance at checkout gives: two settlements racing for the
 * last one both read the same number, and only a condition in the `where`
 * leaves the second with nothing to update. That is also what keeps the count
 * off negative numbers without a check that can be raced.
 */

import { snapshotIn, unitsDelivered } from "./variants";

export interface StockClaim {
    productId: string;
    quantity: number;
}

/** The read half, which the pre-checkout courtesy check is all of. */
export interface StockReader {
    product: {
        findMany(args: {
            where: { id: { in: string[] }; stock: { not: null } };
            select: { id: true; stock: true };
        }): Promise<{ id: string; stock: number | null }[]>;
    };
}

/**
 * The part of the Prisma client the writes need, written out so a transaction
 * client is accepted without widening anything to `any`.
 */
export interface StockClient {
    product: {
        findMany(args: {
            where: { id: { in: string[] }; stock: { not: null } };
            select: { id: true };
        }): Promise<{ id: string }[]>;
        updateMany(args: {
            where: { id: string; stock?: { gte: number } };
            data: { stock: { decrement?: number; increment?: number } };
        }): Promise<{ count: number }>;
    };
}

/**
 * One claim per product, quantities summed.
 *
 * An order can carry the same product on two lines. Left as two claims they
 * are two conditions against two different values, so an order for two of the
 * last one would take one and quietly fail the other; summed, it is one
 * all-or-nothing decision.
 *
 * A line bought as a variant takes the units it delivers, read from what the
 * line kept: a pack of six keys is six keys off a shelf of keys.
 */
export function stockClaims(items: { productId: string | null; quantity: number; metadata?: unknown }[]): StockClaim[] {
    const totals = new Map<string, number>();
    for (const item of items) {
        if (!item.productId) continue;
        const units = unitsDelivered(item.quantity, snapshotIn(item.metadata));
        totals.set(item.productId, (totals.get(item.productId) ?? 0) + units);
    }
    return [...totals].map(([productId, quantity]) => ({ productId, quantity }));
}

/** Products the shop counts, out of the ones claimed. */
async function tracked(client: StockClient, claims: StockClaim[]): Promise<Set<string>> {
    if (claims.length === 0) return new Set();
    const rows = await client.product.findMany({
        where: { id: { in: claims.map((c) => c.productId) }, stock: { not: null } },
        select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
}

/**
 * Take what an order bought. Returns the products there was not enough of,
 * which is empty on the ordinary path.
 *
 * The caller decides what a shortfall means. At settlement it means the shop
 * oversold and the money has already moved, so the order still completes and
 * the shortfall is reported; nothing here refuses anything.
 */
export async function claimStock(client: StockClient, claims: StockClaim[]): Promise<string[]> {
    const counted = await tracked(client, claims);
    const short: string[] = [];
    for (const claim of claims) {
        if (!counted.has(claim.productId)) continue;
        const taken = await client.product.updateMany({
            where: { id: claim.productId, stock: { gte: claim.quantity } },
            data: { stock: { decrement: claim.quantity } },
        });
        if (taken.count === 0) short.push(claim.productId);
    }
    return short;
}

/**
 * Products these claims cannot currently be covered by. Reads only.
 *
 * A courtesy check for the moment before a shopper is sent to a payment page:
 * it is a snapshot, so it cannot promise anything, and the conditional take at
 * settlement is what actually decides. Telling somebody now beats taking their
 * money and telling them afterwards.
 */
export async function shortOfStock(client: StockReader, claims: StockClaim[]): Promise<string[]> {
    if (claims.length === 0) return [];
    const rows = await client.product.findMany({
        where: { id: { in: claims.map((c) => c.productId) }, stock: { not: null } },
        select: { id: true, stock: true },
    });
    const available = new Map(rows.map((row) => [row.id, row.stock ?? 0]));
    return claims
        .filter((claim) => available.has(claim.productId) && (available.get(claim.productId) ?? 0) < claim.quantity)
        .map((claim) => claim.productId);
}

/** Put back what a refunded or cancelled order had taken. */
export async function releaseStock(client: StockClient, claims: StockClaim[]): Promise<void> {
    const counted = await tracked(client, claims);
    for (const claim of claims) {
        if (!counted.has(claim.productId)) continue;
        await client.product.updateMany({
            where: { id: claim.productId },
            data: { stock: { increment: claim.quantity } },
        });
    }
}
