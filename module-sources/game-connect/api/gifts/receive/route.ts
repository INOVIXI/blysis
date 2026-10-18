/**
 * POST /api/v1/game-connect/gifts/receive - whether a player takes gifts.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * and its process in `serverPost`.
 */
import { z } from "zod";
import { refuse } from "../../../lib/auth";
import { receiveGifts } from "../../../lib/bridge";
import { memberOf } from "../../../lib/players";
import { instanceField, playerField } from "../../../lib/schemas";
import { ok, serverPost } from "../../../lib/server-route";

const receiveSchema = z.object({ instance: instanceField, player: playerField, receive: z.boolean() });

export const POST = serverPost(receiveSchema, async (server, body) => {
    const member = await memberOf(server, body.player);
    if (!member) return refuse(409, "not_linked", "This player has no account on the site.");
    return ok({ receiveGifts: await receiveGifts(member.userId, body.receive) });
});
