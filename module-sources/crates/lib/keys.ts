/**
 * Keys bought in the store, put on a member's ring and taken back off it.
 *
 * A crate is sold for money by selling its key as an ordinary product, so the
 * money goes through the store's own checkout, its gateways, its receipts and
 * its refunds, and this module never sees a payment. What it hears is the
 * store saying an order was paid or refunded, with the lines in it.
 *
 * That announcement is not once-only. A gateway retries a webhook it thinks
 * went unanswered and a buyer reloads the page that settles a payment, and
 * both arrive as another "this order was paid". So every line is written down
 * as a `CrateKeyGrant` before its keys are added, with a unique key on the
 * line and the crate, and only the call that wrote the row adds anything.
 */
import type { PrismaTransaction } from "@/core/sdk/server";

/** A line of an order, as the store's order hooks carry it. */
export interface OrderLine {
    id: string;
    productId: string | null;
    quantity: number;
}

export interface PaidOrder {
    id: string;
    userId: string | null;
    items?: readonly OrderLine[];
}

interface KeyDb {
    crateBox: {
        findMany(args: {
            where: { keyProductId: { in: string[] } };
            select: { id: true; keyProductId: true };
            take: number;
        }): Promise<{ id: string; keyProductId: string | null }[]>;
    };
    crateKeyGrant: {
        findMany(args: {
            where: { orderId: string; revokedAt: null };
            select: { id: true; userId: true; crateId: true; quantity: true };
            take: number;
        }): Promise<{ id: string; userId: string; crateId: string; quantity: number }[]>;
    };
    $transaction<T>(work: (tx: PrismaTransaction) => Promise<T>): Promise<T>;
}

/** The most lines one order is read for. A checkout holds far fewer. */
const MOST_LINES = 200;

/**
 * Add the keys a paid order bought. Returns how many keys were added, which is
 * zero the second time the same order is announced.
 */
export async function grantKeysForOrder(db: KeyDb, order: PaidOrder): Promise<number> {
    if (!order.userId) return 0;
    const lines = (order.items ?? []).filter((line) => line.productId && line.quantity > 0);
    if (lines.length === 0) return 0;

    const crates = await db.crateBox.findMany({
        where: { keyProductId: { in: [...new Set(lines.map((line) => line.productId as string))] } },
        select: { id: true, keyProductId: true },
        take: MOST_LINES,
    });
    if (crates.length === 0) return 0;

    const buyer = order.userId;
    let added = 0;
    for (const line of lines) {
        for (const crate of crates.filter((one) => one.keyProductId === line.productId)) {
            added += await db.$transaction(async (tx) => {
                // The row is the receipt. A second announcement of the same
                // order finds it already there and adds nothing.
                const written = await tx.crateKeyGrant.createMany({
                    data: [{
                        orderId: order.id,
                        orderItemId: line.id,
                        userId: buyer,
                        crateId: crate.id,
                        quantity: line.quantity,
                    }],
                    skipDuplicates: true,
                });
                if (written.count === 0) return 0;
                await tx.crateKey.upsert({
                    where: { userId_crateId: { userId: buyer, crateId: crate.id } },
                    create: { userId: buyer, crateId: crate.id, count: line.quantity },
                    update: { count: { increment: line.quantity } },
                });
                return line.quantity;
            });
        }
    }
    return added;
}

/**
 * Take back the keys a refunded order bought, as far as they are still
 * unspent. Returns how many were taken.
 *
 * A key already turned into an opening stays spent: the reward was handed
 * over and the store's refund does not reach into the member's chest or
 * wallet for it. Taking the unspent ones is the part that is certainly owed.
 */
export async function revokeKeysForOrder(db: KeyDb, order: PaidOrder): Promise<number> {
    const grants = await db.crateKeyGrant.findMany({
        where: { orderId: order.id, revokedAt: null },
        select: { id: true, userId: true, crateId: true, quantity: true },
        take: MOST_LINES,
    });

    let taken = 0;
    for (const grant of grants) {
        taken += await db.$transaction(async (tx) => {
            // Claimed first, so a refund announced twice takes back once.
            const claimed = await tx.crateKeyGrant.updateMany({
                where: { id: grant.id, revokedAt: null },
                data: { revokedAt: new Date() },
            });
            if (claimed.count === 0) return 0;
            const ring = await tx.crateKey.findUnique({
                where: { userId_crateId: { userId: grant.userId, crateId: grant.crateId } },
                select: { count: true },
            });
            const take = Math.min(ring?.count ?? 0, grant.quantity);
            if (take <= 0) return 0;
            const done = await tx.crateKey.updateMany({
                where: { userId: grant.userId, crateId: grant.crateId, count: { gte: take } },
                data: { count: { decrement: take } },
            });
            return done.count > 0 ? take : 0;
        });
    }
    return taken;
}
