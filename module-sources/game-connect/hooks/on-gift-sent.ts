/**
 * Tells a member in game that a gift arrived.
 *
 * A gift lands pending in the recipient's chest until they accept it, and
 * nothing in game said so. The event names one game account linked to the
 * recipient and goes to each server of that account's game, never to a
 * server of another game: the one that has the player online says it, in
 * the player's language, the rest find nobody. The sender is
 * named by their account in the same game when they have one, the name the
 * recipient knows them by there, else by their username.
 *
 * On a game where a username is a player name, a member with no link there
 * is the player with their name, named with the offline-mode id when the
 * site derives one and with a null id otherwise.
 */
import { log, prisma } from "@/core/sdk/server";
import { emitEvent } from "../lib/events";
import { accountsByName } from "../lib/names";
import { platformOf } from "../lib/players";
import { nameSettings } from "../lib/settings";

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
        const [recipient, sender, links, servers, settings] = await Promise.all([
            prisma.user.findUnique({ where: { id: recipientId }, select: { username: true } }),
            prisma.user.findUnique({ where: { id: senderId }, select: { username: true } }),
            prisma.gameConnectLink.findMany({
                where: { userId: { in: [recipientId, senderId] } },
                select: { platform: true, externalId: true, name: true, userId: true },
                take: MOST_LINKS * 2,
            }),
            prisma.gameConnectServer.findMany({ where: { enabled: true }, select: { gameServerId: true, game: true } }),
            nameSettings(),
        ]);
        if (!recipient) return;
        const linkedOn = (userId: string) => new Set(links.filter((a) => a.userId === userId).map((a) => a.platform));
        const [recipientNamed, senderNamed] = await Promise.all([
            accountsByName(settings, recipientId, linkedOn(recipientId)),
            accountsByName(settings, senderId, linkedOn(senderId)),
        ]);
        const accounts = [
            ...links,
            ...recipientNamed.map((a) => ({ ...a, userId: recipientId })),
            ...senderNamed.map((a) => ({ ...a, userId: senderId })),
        ];
        const senderIn = new Map(accounts.filter((a) => a.userId === senderId).map((a) => [a.platform, a.name]));
        for (const account of accounts.filter((a) => a.userId === recipientId)) {
            const data = {
                player: { id: account.externalId, name: account.name },
                platform: account.platform,
                from: senderIn.get(account.platform) ?? sender?.username ?? null,
                product: gift.productName ?? "",
                quantity: Number(gift.quantity) || 1,
            };
            for (const server of servers.filter((s) => platformOf(s) === account.platform)) {
                await emitEvent("gift.received", data, server.gameServerId);
            }
        }
    } catch (error) {
        log.warn("[game-connect] a gift could not be told to its recipient", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
};

export default onGiftSent;
