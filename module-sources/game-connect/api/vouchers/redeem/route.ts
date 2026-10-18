/**
 * POST /api/v1/game-connect/vouchers/redeem - a player cashes a voucher in.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * and its process in `serverPost`. No key needed: the voucher redeems once
 * whatever happens, and a retry is told it was used.
 */
import { z } from "zod";
import { rateLimitStrict } from "@/core/sdk/server";
import { refuse } from "../../../lib/auth";
import { balance } from "../../../lib/bridge";
import { memberOf } from "../../../lib/players";
import { instanceField, playerField } from "../../../lib/schemas";
import { ok, serverPost } from "../../../lib/server-route";
import { redeemVoucher } from "../../../lib/vouchers";

const redeemSchema = z.object({ instance: instanceField, player: playerField, voucherId: z.string().min(4).max(64) });

export const POST = serverPost(redeemSchema, async (server, body) => {
    const limited = await rateLimitStrict(`gc-voucher:${server.id}:${body.player.id}`, { maxRequests: 30, windowMs: 60_000 });
    if (!limited.success) return refuse(429, "rate_limited", "Too many vouchers at once.");
    const member = await memberOf(server, body.player);
    if (!member) return refuse(409, "not_linked", "This player has no account on the site.");
    const result = await redeemVoucher(body.voucherId, member.userId);
    if (!result.ok) {
        return result.code === "not_found"
            ? refuse(409, "not_found", "No such voucher.")
            : refuse(409, "voucher_used", "That voucher was already used.", { usedAt: result.usedAt });
    }
    return ok({ amount: result.amount, balance: (await balance(member.userId)) ?? 0 });
});
