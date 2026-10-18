/**
 * POST /api/v1/game-connect/gifts/sent - the gifts a player sent, waiting or accepted.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * and its process in `serverPost`.
 */
import { refuse } from "../../../lib/auth";
import { sentGifts } from "../../../lib/bridge";
import { memberOf } from "../../../lib/players";
import { playerRequest } from "../../../lib/schemas";
import { ok, serverPost } from "../../../lib/server-route";

export const POST = serverPost(playerRequest, async (server, body) => {
    const member = await memberOf(server, body.player);
    if (!member) return refuse(409, "not_linked", "This player has no account on the site.");
    return ok({ items: await sentGifts(member.userId) });
});
