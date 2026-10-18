/**
 * POST /api/v1/game-connect/link/start - a player asks for a code to confirm on the site.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * and its process in `serverPost`.
 */
import { prisma, rateLimitStrict, resolveAppUrl } from "@/core/sdk/server";
import { refuse } from "../../../lib/auth";
import { CODE_TTL_MS, generateCode, hashCode } from "../../../lib/links";
import { memberOf, platformOf } from "../../../lib/players";
import { playerRequest } from "../../../lib/schemas";
import { ok, serverPost } from "../../../lib/server-route";

export const POST = serverPost(playerRequest, async (server, body) => {
    const limited = await rateLimitStrict(`gc-link-start:${server.id}:${body.player.id}`, { maxRequests: 5, windowMs: 10 * 60_000 });
    if (!limited.success) return refuse(429, "rate_limited", "Too many codes asked for. Wait a few minutes.");
    if (await memberOf(server, body.player)) return refuse(409, "already_linked", "This account is already linked.");

    const platform = platformOf(server);
    // One open code per player: asking again replaces the last one.
    await prisma.gameConnectLinkCode.deleteMany({ where: { direction: "game", platform, externalId: body.player.id } });
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await prisma.gameConnectLinkCode.create({
        data: {
            direction: "game",
            codeHash: hashCode(code),
            platform,
            externalId: body.player.id,
            name: body.player.name,
            gameServerId: server.gameServerId,
            expiresAt,
        },
    });
    const url = `${resolveAppUrl().replace(/\/$/, "")}/link?code=${encodeURIComponent(code)}`;
    return ok({ code, url, expiresAt: expiresAt.toISOString() });
});
