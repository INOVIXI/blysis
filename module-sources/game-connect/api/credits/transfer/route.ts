/**
 * POST /api/v1/game-connect/credits/transfer - a player sends credits to another player or member.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * and its process in `serverPost`.
 *
 * Both legs move on one transaction and the debit is conditional on the
 * balance, so two sends of the whole balance cannot both land.
 */
import { z } from "zod";
import { prisma } from "@/core/sdk/server";
import { refuse } from "../../../lib/auth";
import { balance, moveCredits } from "../../../lib/bridge";
import { onceFor } from "../../../lib/idempotency";
import { memberNamed, memberOf } from "../../../lib/players";
import { amountField, instanceField, keyField, playerField } from "../../../lib/schemas";
import { ok, serverPost } from "../../../lib/server-route";

const transferSchema = z.object({
    instance: instanceField,
    player: playerField,
    to: z.string().min(1).max(64),
    amount: amountField,
    idempotencyKey: keyField,
});

export const POST = serverPost(transferSchema, async (server, body) =>
    onceFor(server.id, body.idempotencyKey, async () => {
        const from = await memberOf(server, body.player);
        if (!from) return refuse(409, "not_linked", "This player has no account on the site.");
        const to = await memberNamed(server, body.to);
        if (!to) return refuse(409, "recipient_unknown", "Nobody by that name.");
        if (to.userId === from.userId) return refuse(409, "same_account", "That is the same account.");

        const moved = await prisma.$transaction(async (tx) => {
            const taken = await moveCredits(tx, {
                userId: from.userId,
                amount: -body.amount,
                type: "transfer_out",
                description: `Sent ${body.amount} credits to ${to.username} in game`,
            });
            if (!taken) return false;
            const given = await moveCredits(tx, {
                userId: to.userId,
                amount: body.amount,
                type: "transfer_in",
                description: `Received ${body.amount} credits from ${from.username} in game`,
            });
            if (!given) throw new Error("credit not recorded");
            return true;
        });
        if (!moved) return refuse(409, "insufficient_balance", "Not enough credits.");
        return ok({ sent: body.amount, to: to.username, balance: (await balance(from.userId)) ?? 0 });
    }),
);
