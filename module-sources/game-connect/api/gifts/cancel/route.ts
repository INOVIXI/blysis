/**
 * POST /api/v1/game-connect/gifts/cancel - the sender takes back a gift nobody accepted.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * and its process in `serverPost`.
 */
import { z } from "zod";
import { refuse } from "../../../lib/auth";
import { cancelGift } from "../../../lib/bridge";
import { refused } from "../../../lib/chest-answers";
import { onceFor } from "../../../lib/idempotency";
import { memberOf } from "../../../lib/players";
import { instanceField, keyField, playerField } from "../../../lib/schemas";
import { ok, serverPost } from "../../../lib/server-route";

const cancelSchema = z.object({ instance: instanceField, player: playerField, itemId: z.string().min(1).max(64), idempotencyKey: keyField });

export const POST = serverPost(cancelSchema, async (server, body) =>
    onceFor(server.id, body.idempotencyKey, async () => {
        const member = await memberOf(server, body.player);
        if (!member) return refuse(409, "not_linked", "This player has no account on the site.");
        const result = await cancelGift(member.userId, body.itemId);
        return result.ok ? ok({ refunded: result.refunded, balance: result.balance }) : refused(result.code);
    }),
);
