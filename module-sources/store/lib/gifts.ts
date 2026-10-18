/**
 * The chest and the gifts in it, for the site's own screen and for a game.
 *
 * A gift arrives pending. Until its recipient accepts it, it is the sender's
 * to take back, and only once accepted is it an ordinary chest row its owner
 * can claim. Accepting and taking back race on one row, and each is a write
 * conditional on the row still being pending, so exactly one of them wins.
 *
 * A gift that was bought as a gift comes back as the money it cost. A gift
 * that was an item handed over from the sender's chest comes back as that
 * item. Either way nothing is left with the recipient.
 */
import { applyFiltersAsync } from "@/core/sdk";
import { log, moduleSettings, prisma } from "@/core/sdk/server";
import { deliverProduct } from "./delivery";
import { deliveryFor } from "./chest";
import { releaseStock, stockClaims } from "./stock";
import { uncountSales } from "./popularity";

export const PENDING = "pending";

/** Whether the site lets anything be given away at all. Absent means on. */
export async function siteAllowsGifting(): Promise<boolean> {
    const { enableChestGifting } = await moduleSettings<{ enableChestGifting: boolean }>("store");
    return enableChestGifting !== false;
}

async function usernames(ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    const rows = await prisma.user.findMany({
        where: { id: { in: wanted } },
        select: { id: true, username: true },
        take: wanted.length,
    });
    return new Map(rows.map((row) => [row.id, row.username]));
}

async function inGameLooks(productIds: string[]): Promise<Map<string, { title: string | null; icon: string | null }>> {
    if (productIds.length === 0) return new Map();
    const rows = await prisma.product.findMany({
        where: { id: { in: [...new Set(productIds)] } },
        select: { id: true, gameTitle: true, gameIcon: true },
        take: productIds.length,
    });
    return new Map(rows.map((row) => [row.id, { title: row.gameTitle, icon: row.gameIcon }]));
}

export async function receivesGifts(userId: string): Promise<boolean> {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { receiveGifts: true } });
    return row?.receiveGifts === true;
}

export async function setReceivesGifts(userId: string, receive: boolean | null): Promise<boolean> {
    if (receive === null) return receivesGifts(userId);
    const row = await prisma.user.update({ where: { id: userId }, data: { receiveGifts: receive }, select: { receiveGifts: true } });
    return row.receiveGifts;
}

/** What a member has not claimed yet, gifts waiting for them included. */
export async function listChest(userId: string): Promise<{ items: ChestEntry[]; receiveGifts: boolean }> {
    const rows = await prisma.chestItem.findMany({
        where: { userId, isRedeemed: false },
        orderBy: { createdAt: "desc" },
        take: 200,
    });
    const [senders, looks, receiveGifts] = await Promise.all([
        usernames(rows.map((row) => row.giftedById)),
        inGameLooks(rows.map((row) => row.productId)),
        receivesGifts(userId),
    ]);
    return {
        receiveGifts,
        items: rows.map((row) => ({
            id: row.id,
            productId: row.productId,
            title: looks.get(row.productId)?.title || row.productName,
            icon: looks.get(row.productId)?.icon ?? null,
            quantity: row.quantity,
            state: row.giftState === PENDING ? "pending_gift" : "ready",
            from: row.giftedById ? (senders.get(row.giftedById) ?? null) : null,
            createdAt: row.createdAt.toISOString(),
        })),
    };
}

/**
 * The gifts a member sent, newest first: those still waiting and those accepted.
 *
 * A game draws the product's in-game title and icon. The site's own screen
 * names the row as the chest does, so it does not ask for them.
 */
export async function sentGifts(userId: string, view: { inGame: boolean } = { inGame: true }): Promise<SentGift[]> {
    const rows = await prisma.chestItem.findMany({
        where: { giftedById: userId },
        orderBy: { createdAt: "desc" },
        take: 100,
    });
    const [recipients, looks] = await Promise.all([
        usernames(rows.map((row) => row.userId)),
        view.inGame ? inGameLooks(rows.map((row) => row.productId)) : new Map<string, { title: string | null; icon: string | null }>(),
    ]);
    return rows.map((row) => ({
        id: row.id,
        title: looks.get(row.productId)?.title || row.productName,
        icon: looks.get(row.productId)?.icon ?? null,
        quantity: row.quantity,
        to: recipients.get(row.userId) ?? "",
        state: row.giftState === PENDING ? "pending_gift" : "accepted",
        createdAt: row.createdAt.toISOString(),
    }));
}

/** The recipient accepts. Conditional on the gift still waiting, so a cancel racing it finds nothing. */
export async function activateGift(userId: string, itemId: string): Promise<ChestActionResult> {
    const changed = await prisma.chestItem.updateMany({
        where: { id: itemId, userId, giftState: PENDING, isRedeemed: false },
        data: { giftState: null },
    });
    if (changed.count > 0) return { ok: true };
    const exists = await prisma.chestItem.findFirst({ where: { id: itemId, userId }, select: { id: true } });
    return { ok: false, code: exists ? "not_pending" : "not_found" };
}

/**
 * The sender takes a gift back.
 *
 * The row is removed by a write conditional on it still pending, inside the
 * same transaction as the refund, so an accept that won the race leaves this
 * with nothing to remove and nothing to refund.
 */
export async function cancelGift(senderId: string, itemId: string): Promise<GiftCancelResult> {
    const item = await prisma.chestItem.findFirst({ where: { id: itemId, giftedById: senderId } });
    if (!item) return { ok: false, code: "not_found" };
    if (item.giftState !== PENDING || item.isRedeemed) return { ok: false, code: "not_pending" };

    const order = item.orderId
        ? await prisma.order.findUnique({ where: { id: item.orderId }, include: { items: true } })
        : null;
    // Bought as a gift: the sender paid for the order and it carries nothing
    // but this. Anything else was an item handed over from the sender's chest.
    const boughtAsGift =
        order !== null &&
        order.userId === senderId &&
        (order.metadata as Record<string, unknown> | null)?.gift === true;

    try {
        const outcome = await prisma.$transaction(async (tx) => {
            if (boughtAsGift && order) {
                const removed = await tx.chestItem.deleteMany({ where: { id: item.id, giftState: PENDING, isRedeemed: false } });
                if (removed.count === 0) return null;
                const refund = Number(order.total);
                await tx.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } });
                await tx.ownedProduct.deleteMany({ where: { orderId: order.id, userId: item.userId } });
                const claims = stockClaims(order.items);
                await releaseStock(tx, claims);
                await uncountSales(tx, claims);
                if (refund > 0) {
                    const credited = await applyFiltersAsync("credit.change", { applied: false }, {
                        tx,
                        userId: senderId,
                        amount: refund,
                        type: "gift_refund",
                        description: `Gift taken back (order ${order.orderNumber})`,
                    });
                    if (!credited.applied) throw new Error("REFUND_NOT_RECORDED");
                }
                return refund;
            }
            const moved = await tx.chestItem.updateMany({
                where: { id: item.id, giftState: PENDING, isRedeemed: false },
                data: { userId: senderId, giftState: null, giftedById: null, giftedToId: null },
            });
            return moved.count === 0 ? null : 0;
        });
        if (outcome === null) return { ok: false, code: "not_pending" };
        const balance = await prisma.user.findUnique({ where: { id: senderId }, select: { creditBalance: true } });
        return { ok: true, refunded: outcome, balance: Number(balance?.creditBalance ?? 0) };
    } catch (error) {
        log.error("[store] a gift could not be taken back", { itemId, error: error instanceof Error ? error.message : String(error) });
        return { ok: false, code: "unavailable" };
    }
}

/**
 * Claims a ready chest row and hands it to delivery.
 *
 * The row is claimed before delivery, conditionally, so two claims that
 * arrive together cannot both deliver. A pending gift cannot be claimed: it
 * is not the recipient's until they accept it.
 */
export async function claimChestItem(
    userId: string,
    itemId: string,
    player: { name: string | null; id: string | null },
): Promise<ChestActionResult> {
    const item = await prisma.chestItem.findUnique({ where: { id: itemId } });
    if (!item || item.userId !== userId) return { ok: false, code: "not_found" };
    if (item.isRedeemed) return { ok: false, code: "already_claimed" };
    if (item.giftState === PENDING) return { ok: false, code: "not_pending" };

    const commands = await prisma.productCommand.findMany({ where: { productId: item.productId }, orderBy: { order: "asc" } });
    const delivery = commands.length > 0 ? deliveryFor(item, { playerName: player.name }) : null;
    if (delivery && "needsPlayerName" in delivery) return { ok: false, code: "needs_player_name" };

    const claimed = await prisma.chestItem.updateMany({
        where: { id: item.id, userId, isRedeemed: false, giftState: null },
        data: { isRedeemed: true, redeemedAt: new Date() },
    });
    if (claimed.count === 0) return { ok: false, code: "already_claimed" };

    if (delivery && !("needsPlayerName" in delivery)) {
        // The id goes with the name only when they belong together: a row
        // bought for another name is that name's, whoever claims it.
        const sameName = player.name !== null && delivery.playerName.toLowerCase() === player.name.toLowerCase();
        await deliverProduct({
            playerName: delivery.playerName,
            playerId: sameName ? player.id : null,
            userId,
            productName: delivery.productName,
            commands: commands.map((c) => ({ command: c.command, serverId: c.serverId, target: c.target, whenOnline: c.whenOnline })),
            quantity: delivery.quantity,
            variables: delivery.variables,
            reference: { kind: "chest", id: item.id, label: item.productName },
            line: item.id,
        }).catch((error: unknown) =>
            log.error("[store] delivering a chest reward failed", { error: error instanceof Error ? error.message : String(error) }),
        );
    }
    return { ok: true };
}
