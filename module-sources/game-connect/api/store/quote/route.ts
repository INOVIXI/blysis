/**
 * POST /api/v1/game-connect/store/quote - what a purchase would take from this player, before they confirm it.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * and its process in `serverPost`.
 *
 * The catalogue is the same for every player, so its price is the product's.
 * A member who owns a cheaper product on the same shelf, or buys enough for a
 * bulk discount, pays less, and only the store can say how much. A game shows
 * this on its confirm button, so the number on the screen is the number taken.
 * It moves no money, so it needs no idempotency key.
 */
import { z } from "zod";
import { refuse } from "../../../lib/auth";
import { quote } from "../../../lib/bridge";
import { memberNamed, memberOf } from "../../../lib/players";
import { instanceField, playerField } from "../../../lib/schemas";
import { ok, serverPost } from "../../../lib/server-route";

const quoteSchema = z.object({
    instance: instanceField,
    player: playerField,
    productId: z.string().min(1).max(64),
    quantity: z.number().int(),
    recipient: z.string().min(1).max(64).nullish(),
});

export const POST = serverPost(quoteSchema, async (server, body) => {
    const buyer = await memberOf(server, body.player);
    if (!buyer) return refuse(409, "not_linked", "This player has no account on the site.");
    let recipientId: string | null = null;
    if (body.recipient) {
        const recipient = await memberNamed(server, body.recipient);
        if (!recipient) return refuse(409, "recipient_unknown", "Nobody by that name.");
        recipientId = recipient.userId === buyer.userId ? null : recipient.userId;
    }
    const result = await quote({ buyerId: buyer.userId, productId: body.productId, quantity: body.quantity, recipientId });
    if (!result.ok) {
        return result.code === "unavailable"
            ? refuse(503, "unavailable", "No store answers.")
            : refuse(409, result.code, "That cannot be bought in game.");
    }
    return ok({ each: result.each, total: result.total });
});
