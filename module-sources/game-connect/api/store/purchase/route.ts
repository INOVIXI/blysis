/**
 * POST /api/v1/game-connect/store/purchase - a player buys with credits, for themselves or as a gift.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * and its process in `serverPost`.
 *
 * The store decides everything about the sale. This resolves who is buying
 * and who it is for, and makes sure a retry is the same purchase.
 */
import { z } from "zod";
import { refuse } from "../../../lib/auth";
import { purchase } from "../../../lib/bridge";
import { onceFor } from "../../../lib/idempotency";
import { memberNamed, memberOf } from "../../../lib/players";
import { instanceField, keyField, playerField } from "../../../lib/schemas";
import { ok, serverPost } from "../../../lib/server-route";

const purchaseSchema = z.object({
    instance: instanceField,
    player: playerField,
    productId: z.string().min(1).max(64),
    quantity: z.number().int(),
    fields: z.record(z.string().max(64), z.string().max(200)).default({}),
    recipient: z.string().min(1).max(64).nullish(),
    idempotencyKey: keyField,
});

const MESSAGES: Record<string, string> = {
    not_found: "No such product.",
    not_in_game: "That product is not sold in game.",
    insufficient_balance: "Not enough credits.",
    out_of_stock: "Out of stock.",
    quantity_invalid: "That quantity cannot be bought.",
    field_invalid: "A field is missing or wrong.",
    not_giftable: "That product cannot be given.",
    recipient_refuses_gifts: "That member does not accept gifts.",
    unavailable: "The store cannot sell that right now.",
};

/** The most of one product a single purchase may name, whatever the product allows. */
const MOST = 1000;

export const POST = serverPost(purchaseSchema, async (server, body) =>
    body.quantity < 1 || body.quantity > MOST
        ? refuse(409, "quantity_invalid", MESSAGES.quantity_invalid)
        : onceFor(server.id, body.idempotencyKey, async () => {
        const buyer = await memberOf(server, body.player);
        if (!buyer) return refuse(409, "not_linked", "This player has no account on the site.");
        let recipientId: string | null = null;
        if (body.recipient) {
            const recipient = await memberNamed(server, body.recipient);
            if (!recipient) return refuse(409, "recipient_unknown", "Nobody by that name.");
            recipientId = recipient.userId === buyer.userId ? null : recipient.userId;
        }

        const result = await purchase({
            buyerId: buyer.userId,
            productId: body.productId,
            quantity: body.quantity,
            fields: body.fields,
            recipientId,
            playerName: body.player.name,
            playerId: body.player.id,
            channel: `game:${server.gameServerId}`,
        });
        if (!result.ok) {
            const status = result.code === "unavailable" && !result.reason ? 503 : 409;
            return refuse(status, result.code, MESSAGES[result.code] ?? "Refused.", {
                ...(result.field ? { field: result.field } : {}),
                ...(result.reason ? { reason: result.reason } : {}),
            });
        }
        return ok({ orderId: result.orderId, orderNumber: result.orderNumber, total: result.total, balance: result.balance, gift: result.gift });
    }),
);
