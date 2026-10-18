/**
 * Tells a member in game that a gift arrived.
 *
 * A gift lands pending in the recipient's chest until they accept it, and
 * nothing in game said so. The event names each game account linked to the
 * recipient and goes to every server: the one that has the player online
 * says it, in the player's language, the rest find nobody. The sender is
 * named by their account in the same game when they have one, the name the
 * recipient knows them by there, else by their username.
 */
import { log, prisma } from "@/core/sdk/server";
import { emitEvent } from "../lib/events";

/** The store's payload, spelled out: this module does not depend on the store. */
interface GiftSent {
    senderId?: string;
    recipientId?: string;
    productName?: string;
    quantity?: number;
}

/** A member has one account per game at most, so this is a handful of rows. */
const MOST_LINKS = 20;

const onGiftSent = async (gift: GiftSent): Promise<void> => {
    try {
        if (!gift?.recipientId || !gift.senderId) return;
        const recipientId = gift.recipientId;
        const senderId = gift.senderId;
        const [recipient, sender, accounts] = await Promise.all([
            prisma.user.findUnique({ where: { id: recipientId }, select: { username: true } }),
            prisma.user.findUnique({ where: { id: senderId }, select: { username: true } }),
            prisma.gameConnectLink.findMany({
                where: { userId: { in: [recipientId, senderId] } },
                select: { platform: true, externalId: true, name: true, userId: true },
                take: MOST_LINKS * 2,
            }),
        ]);
        if (!recipient) return;
        const senderIn = new Map(accounts.filter((a) => a.userId === senderId).map((a) => [a.platform, a.name]));
        for (const account of accounts.filter((a) => a.userId === recipientId)) {
            await emitEvent("gift.received", {
                player: { id: account.externalId, name: account.name },
                platform: account.platform,
                member: recipient.username,
                from: senderIn.get(account.platform) ?? sender?.username ?? null,
                product: gift.productName ?? "",
                quantity: Number(gift.quantity) || 1,
            });
        }
    } catch (error) {
        log.warn("[game-connect] a gift could not be told to its recipient", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
};

export default onGiftSent;
