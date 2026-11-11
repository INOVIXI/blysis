/**
 * POST /api/v1/game-connect/link/verify - a player types the code a member made on the site.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * and its process in `serverPost`.
 *
 * Refused on a game where a username is a player name, before the code is
 * read, so a code made earlier is not spent.
 */
import { z } from "zod";
import { rateLimitStrict } from "@/core/sdk/server";
import { refuse } from "../../../lib/auth";
import { bind, spend } from "../../../lib/links";
import { namesPlayers } from "../../../lib/names";
import { platformOf } from "../../../lib/players";
import { instanceField, playerField } from "../../../lib/schemas";
import { ok, serverPost } from "../../../lib/server-route";
import { nameSettings } from "../../../lib/settings";

const verifySchema = z.object({ instance: instanceField, player: playerField, code: z.string().min(4).max(32) });

export const POST = serverPost(verifySchema, async (server, body) => {
    if (namesPlayers(await nameSettings(), platformOf(server))) {
        return refuse(409, "linked_by_name", "Players on this game are linked by name: the member whose username is the player name is that player.");
    }
    // A ceiling on guesses per player: the code space is large, the ceiling
    // keeps it that way.
    const limited = await rateLimitStrict(`gc-link-verify:${server.id}:${body.player.id}`, { maxRequests: 5, windowMs: 10 * 60_000 });
    if (!limited.success) return refuse(429, "rate_limited", "Too many codes tried. Wait a few minutes.");

    const code = await spend(body.code, "site");
    if (!code?.userId) return refuse(409, "code_invalid", "That code is wrong, used or expired.");

    const bound = await bind(platformOf(server), body.player.id, body.player.name, code.userId);
    if (!bound.ok) return refuse(409, bound.code, "That account or that member is already linked.");
    return ok({ linked: true, member: { username: bound.username } });
});
