/**
 * POST /api/v1/game-connect/chest/claim - send a ready chest item to delivery.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * and its process in `serverPost`.
 */
import { z } from "zod";
import { refuse } from "../../../lib/auth";
import { claimChest } from "../../../lib/bridge";
import { refused } from "../../../lib/chest-answers";
import { onceFor } from "../../../lib/idempotency";
import { memberOf } from "../../../lib/players";
import { instanceField, keyField, playerField } from "../../../lib/schemas";
import { ok, serverPost } from "../../../lib/server-route";

const claimSchema = z.object({ instance: instanceField, player: playerField, itemId: z.string().min(1).max(64), idempotencyKey: keyField });

export const POST = serverPost(claimSchema, async (server, body) =>
    onceFor(server.id, body.idempotencyKey, async () => {
        const member = await memberOf(server, body.player);
        if (!member) return refuse(409, "not_linked", "This player has no account on the site.");
        const result = await claimChest(member.userId, body.itemId, body.player);
        return result.ok ? ok({ ok: true }) : refused(result.code);
    }),
);
