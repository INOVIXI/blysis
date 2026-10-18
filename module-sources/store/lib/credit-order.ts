/**
 * Placing an order paid in credits, and handing it to delivery.
 *
 * Two paths pay in credits: the checkout page, and a game server selling on
 * the site's behalf. Both have to take the money, the stock and the order in
 * one transaction, and both have to treat the chest the same way afterwards,
 * so both call this rather than each keeping a copy that drifts.
 */
import { Prisma } from "@prisma/client";
import { applyFiltersAsync, generateOrderNumber } from "@/core/sdk";
import { log, prisma, type PrismaTransaction } from "@/core/sdk/server";
import { claimStock, stockClaims } from "./stock";
import { countSales } from "./popularity";
import { recordedVariables } from "./chest";
import { deliverProduct } from "./delivery";

/** Thrown inside the transaction, so the debit rolls back with it. */
export const INSUFFICIENT_CREDITS = "INSUFFICIENT_CREDITS";
export const OUT_OF_STOCK = "OUT_OF_STOCK";

export interface CreditOrderLine {
    productId: string;
    name: string;
    price: number;
    quantity: number;
    metadata: Prisma.InputJsonValue;
}

export interface CreditOrderInput {
    buyerId: string;
    /** Who the goods belong to: the buyer, or the member a gift is for. */
    ownerId: string;
    /** Set for a gift: the rows land pending, and the sender can take them back. */
    gift: boolean;
    lines: CreditOrderLine[];
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
    currency: string;
    notes?: string | null;
    billingDetails: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    metadata: Prisma.InputJsonValue;
    playerName: string | null;
    description: string;
}

/**
 * The money, the shelf and the order, together or not at all.
 *
 * The debit is conditional on the balance still covering it, which is the
 * wallet's own rule; a check before the transaction is only a snapshot, and
 * two purchases submitted together both pass a snapshot.
 */
export async function createCreditOrder(tx: PrismaTransaction, input: CreditOrderInput) {
    const debited = await applyFiltersAsync("credit.change", { applied: false }, {
        tx,
        userId: input.buyerId,
        amount: -input.total,
        type: "purchase",
        description: input.description,
    });
    if (!debited.applied) throw new Error(INSUFFICIENT_CREDITS);

    const claims = stockClaims(input.lines);
    const short = await claimStock(tx, claims);
    if (short.length > 0) throw new Error(OUT_OF_STOCK);
    await countSales(tx, claims);

    const order = await tx.order.create({
        data: {
            orderNumber: generateOrderNumber(),
            userId: input.buyerId,
            status: "COMPLETED",
            subtotal: input.subtotal,
            discount: input.discount,
            billingDetails: input.billingDetails,
            tax: input.tax,
            total: input.total,
            currency: input.currency.toUpperCase(),
            notes: input.notes ?? null,
            paymentMethod: "credits",
            metadata: input.metadata,
            items: { create: input.lines },
        },
        include: { items: true },
    });

    await tx.chestItem.createMany({
        data: input.lines.map((line) => ({
            userId: input.ownerId,
            productId: line.productId,
            productName: line.name,
            quantity: line.quantity,
            orderId: order.id,
            playerName: input.gift ? null : input.playerName,
            variables: recordedVariables(line.metadata) ?? Prisma.JsonNull,
            ...(input.gift ? { giftState: "pending", giftedById: input.buyerId, giftedToId: input.ownerId } : {}),
        })),
    });
    await tx.ownedProduct.createMany({
        data: [...new Set(input.lines.map((line) => line.productId))].map((productId) => ({
            userId: input.ownerId,
            productId,
            orderId: order.id,
        })),
        skipDuplicates: true,
    });

    return order;
}

export interface DeliveryPlayer {
    name: string;
    id: string | null;
    userId: string | null;
}

/**
 * Hands a paid order's lines to delivery, and closes the chest rows that
 * delivery took.
 *
 * Every paid line also gets a chest row. Before this, a line whose commands
 * ran at payment kept an unredeemed row too, and its buyer could claim the
 * same goods again from the chest. A row is closed only when every command of
 * its line was taken, run or queued; one nothing could take stays claimable,
 * which is what the chest is for.
 */
export async function deliverPaidOrder(
    order: { id: string; items: { id: string; productId: string | null; name: string; quantity: number; metadata: unknown }[] },
    player: DeliveryPlayer,
): Promise<void> {
    const lines = order.items.filter((item): item is typeof item & { productId: string } => Boolean(item.productId));
    if (lines.length === 0) return;

    const commandRows = await prisma.productCommand.findMany({
        where: { productId: { in: [...new Set(lines.map((line) => line.productId))] } },
        orderBy: { order: "asc" },
    });
    const byProduct = new Map<string, typeof commandRows>();
    for (const row of commandRows) {
        const list = byProduct.get(row.productId);
        if (list) list.push(row);
        else byProduct.set(row.productId, [row]);
    }

    for (const line of lines) {
        const commands = byProduct.get(line.productId);
        if (!commands || commands.length === 0) continue;

        // The line's chest rows are claimed before its commands run, and put
        // back if nothing could take them. Closing them only afterwards left
        // them claimable for as long as delivery took, so a chest claim in
        // that window delivered the same goods a second time. A row that was
        // already claimed means the chest delivered it: this does not.
        const rows = await prisma.chestItem.findMany({
            where: { orderId: order.id, productId: line.productId, giftState: null },
            select: { id: true, isRedeemed: true },
            take: 100,
        });
        const open = rows.filter((row) => !row.isRedeemed).map((row) => row.id);
        if (rows.length > 0 && open.length === 0) continue;
        const claimedAt = new Date();
        if (open.length > 0) {
            const claimed = await prisma.chestItem.updateMany({
                where: { id: { in: open }, isRedeemed: false, giftState: null },
                data: { isRedeemed: true, redeemedAt: claimedAt },
            });
            if (claimed.count === 0) continue;
        }

        const variables = (line.metadata as Record<string, unknown> | null)?.variables as Record<string, string> | undefined;
        let delivered = false;
        try {
            const result = await deliverProduct({
                playerName: player.name,
                playerId: player.id,
                userId: player.userId,
                productName: line.name,
                commands: commands.map((c) => ({ command: c.command, serverId: c.serverId, target: c.target, whenOnline: c.whenOnline })),
                quantity: line.quantity,
                variables,
                reference: { kind: "order", id: order.id, label: line.name },
                line: line.id,
            });
            delivered = result.success;
        } catch (error) {
            log.error("[store] delivery failed", { orderId: order.id, error: error instanceof Error ? error.message : String(error) });
        }
        if (!delivered && open.length > 0) {
            await prisma.chestItem.updateMany({
                where: { id: { in: open }, isRedeemed: true, redeemedAt: claimedAt },
                data: { isRedeemed: false, redeemedAt: null },
            });
        }
    }
}
