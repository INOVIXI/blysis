/**
 * Puts an unpaid order's lines back in its buyer's basket.
 *
 * Starting a checkout empties the basket, so the link in a checkout reminder
 * had nothing to lead back to: the buyer arrived at an empty cart and had to
 * find every product again. This fills it from the order instead, and the
 * checkout then prices it afresh, so nothing here decides what anybody pays.
 *
 * Only the buyer's own order, and only while it is still unpaid: a paid one
 * is finished, and anybody else's is not theirs to see. A product that has
 * since been switched off or deleted is left out rather than refused, and the
 * basket's line cap still holds.
 */
import { snapshotIn } from "./variants";

/** The most of one line a basket holds, as the checkout accepts it. */
const MAX_QUANTITY = 99;

export interface RestoreDb {
    order: {
        findFirst(args: {
            where: { id: string; userId: string; status: "PENDING" };
            select: { items: { select: { productId: true; quantity: true; metadata: true } } };
        }): Promise<{ items: { productId: string | null; quantity: number; metadata?: unknown }[] } | null>;
    };
    product: {
        findMany(args: {
            where: { id: { in: string[] }; isActive: true };
            select: { id: true };
        }): Promise<{ id: string }[]>;
    };
    cartItem: {
        findMany(args: { where: { userId: string }; select: { productId: true } }): Promise<{ productId: string }[]>;
        upsert(args: {
            where: { userId_productId: { userId: string; productId: string } };
            update: { quantity: number; variantId: string | null };
            create: { userId: string; productId: string; quantity: number; variantId: string | null };
        }): Promise<unknown>;
    };
}

/** How many lines went back, or null when there was no such unpaid order of theirs. */
export async function restoreCartFromOrder(
    db: RestoreDb,
    userId: string,
    orderId: string,
    maxCartItems: number,
): Promise<number | null> {
    const order = await db.order.findFirst({
        where: { id: orderId, userId, status: "PENDING" },
        select: { items: { select: { productId: true, quantity: true, metadata: true } } },
    });
    if (!order) return null;

    const wanted = new Map<string, number>();
    // The variant each line was put in the basket as, so the basket comes
    // back as it was. One the shop has since taken away leaves the line
    // asking for another, as the cart says.
    const variantOf = new Map<string, string | null>();
    for (const item of order.items) {
        if (!item.productId) continue;
        variantOf.set(item.productId, snapshotIn(item.metadata)?.id ?? null);
        wanted.set(item.productId, Math.min(MAX_QUANTITY, (wanted.get(item.productId) ?? 0) + item.quantity));
    }
    if (wanted.size === 0) return 0;

    const [live, inCart] = await Promise.all([
        db.product.findMany({ where: { id: { in: [...wanted.keys()] }, isActive: true }, select: { id: true } }),
        db.cartItem.findMany({ where: { userId }, select: { productId: true } }),
    ]);
    const held = new Set(inCart.map((line) => line.productId));
    let lines = held.size;
    let restored = 0;

    for (const { id } of live) {
        if (!held.has(id)) {
            if (lines >= maxCartItems) continue;
            lines++;
        }
        const quantity = wanted.get(id) ?? 1;
        await db.cartItem.upsert({
            where: { userId_productId: { userId, productId: id } },
            update: { quantity, variantId: variantOf.get(id) ?? null },
            create: { userId, productId: id, quantity, variantId: variantOf.get(id) ?? null },
        });
        restored++;
    }
    return restored;
}
