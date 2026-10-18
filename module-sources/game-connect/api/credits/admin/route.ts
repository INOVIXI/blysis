/**
 * POST /api/v1/game-connect/credits/admin - staff in game add, remove, set or read a balance.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * and its process in `serverPost`.
 *
 * Only for a server an admin allowed: a token that may add credits can mint
 * money, so `allowCreditAdmin` is off until somebody turns it on. Who in game
 * may run the command is the game server's own permission check.
 */
import { z } from "zod";
import { logActivity, prisma } from "@/core/sdk/server";
import { refuse } from "../../../lib/auth";
import { balance, moveCredits } from "../../../lib/bridge";
import { onceFor } from "../../../lib/idempotency";
import { memberNamed } from "../../../lib/players";
import { instanceField, keyField, playerField } from "../../../lib/schemas";
import { ok, serverPost } from "../../../lib/server-route";

const adminSchema = z.object({
    instance: instanceField,
    actor: playerField,
    target: z.string().min(1).max(64),
    operation: z.enum(["add", "remove", "set", "show"]),
    amount: z.number().min(0).max(99_999_999).optional(),
    idempotencyKey: keyField.optional(),
});

export const POST = serverPost(adminSchema, async (server, body) => {
    if (!server.allowCreditAdmin) {
        return refuse(403, "not_allowed", "This server may not manage credits.", { setting: "allowCreditAdmin" });
    }
    const target = await memberNamed(server, body.target);
    if (!target) return refuse(409, "recipient_unknown", "Nobody by that name.");
    if (body.operation === "show") return ok({ target: target.username, balance: (await balance(target.userId)) ?? 0 });

    const amount = body.amount;
    if (amount === undefined || (body.operation !== "set" && amount <= 0) || Math.round(amount * 100) !== amount * 100) {
        return refuse(409, "amount_invalid", "Name an amount.");
    }
    if (!body.idempotencyKey) return refuse(422, "invalid_request", "A change needs an idempotencyKey.");

    return onceFor(server.id, body.idempotencyKey, async () => {
        const changed = await prisma.$transaction(async (tx) => {
            const now = (await balance(target.userId)) ?? 0;
            const delta = body.operation === "add" ? amount : body.operation === "remove" ? -amount : amount - now;
            if (delta === 0) return true;
            return moveCredits(tx, {
                userId: target.userId,
                amount: delta,
                type: delta > 0 ? "admin_grant" : "admin_remove",
                description: `${body.operation} by ${body.actor.name} in game`,
            });
        });
        if (!changed) return refuse(409, "insufficient_balance", "That would take the balance below zero.");
        logActivity({
            userId: target.userId,
            action: "game-connect.credits.changed",
            entity: "user",
            entityId: target.userId,
            metadata: { operation: body.operation, amount, actor: body.actor.name, server: server.gameServerId },
        }).catch(() => {});
        return ok({ target: target.username, balance: (await balance(target.userId)) ?? 0 });
    });
});
