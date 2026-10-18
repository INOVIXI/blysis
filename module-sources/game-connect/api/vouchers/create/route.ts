/**
 * POST /api/v1/game-connect/vouchers/create - a player turns credits into a voucher.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * and its process in `serverPost`.
 */
import { z } from "zod";
import { refuse } from "../../../lib/auth";
import { balance } from "../../../lib/bridge";
import { onceFor } from "../../../lib/idempotency";
import { memberOf } from "../../../lib/players";
import { amountField, amountRefused, instanceField, isAmount, keyField, playerField } from "../../../lib/schemas";
import { ok, serverPost } from "../../../lib/server-route";
import { createVoucher } from "../../../lib/vouchers";

const createSchema = z.object({ instance: instanceField, player: playerField, amount: amountField, idempotencyKey: keyField });

export const POST = serverPost(createSchema, async (server, body) =>
    !isAmount(body.amount) ? amountRefused() : onceFor(server.id, body.idempotencyKey, async () => {
        const member = await memberOf(server, body.player);
        if (!member) return refuse(409, "not_linked", "This player has no account on the site.");
        const made = await createVoucher(member.userId, body.amount, server.gameServerId);
        if (!made.ok) return refuse(409, made.code, "Not enough credits.");
        return ok({ voucherId: made.voucherId, amount: made.amount, balance: (await balance(member.userId)) ?? 0 });
    }),
);
