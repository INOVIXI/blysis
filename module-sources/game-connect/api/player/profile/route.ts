/**
 * POST /api/v1/game-connect/player/profile - whether a player has an account here, and its state.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * and its process in `serverPost`.
 */
import { balance, receiveGifts } from "../../../lib/bridge";
import { memberOf } from "../../../lib/players";
import { playerRequest } from "../../../lib/schemas";
import { ok, serverPost } from "../../../lib/server-route";

export const POST = serverPost(playerRequest, async (server, body) => {
    const member = await memberOf(server, body.player);
    if (!member) return ok({ linked: false });
    const [held, takesGifts] = await Promise.all([balance(member.userId), receiveGifts(member.userId, null)]);
    return ok({ linked: true, member: { username: member.username, balance: held ?? 0, receiveGifts: takesGifts } });
});
