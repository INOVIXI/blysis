/**
 * POST /api/v1/game-connect/vouchers/give - staff mint a voucher nobody paid for.
 *
 * @provider-callback: the caller is a game server, authenticated by its token
 * and its process in `serverPost`. Only for a server with `allowVoucherGive`,
 * which is off until an admin turns it on: minting a voucher mints money.
 */
import { z } from "zod";
import { logActivity } from "@/core/sdk/server";
import { refuse } from "../../../lib/auth";
import { onceFor } from "../../../lib/idempotency";
import { amountField, instanceField, keyField, playerField } from "../../../lib/schemas";
import { ok, serverPost } from "../../../lib/server-route";
import { mintVoucher } from "../../../lib/vouchers";

const giveSchema = z.object({ instance: instanceField, actor: playerField, amount: amountField, idempotencyKey: keyField });

export const POST = serverPost(giveSchema, async (server, body) => {
    if (!server.allowVoucherGive) {
        return refuse(403, "not_allowed", "This server may not mint vouchers.", { setting: "allowVoucherGive" });
    }
    return onceFor(server.id, body.idempotencyKey, async () => {
        const minted = await mintVoucher(body.amount, server.gameServerId);
        logActivity({
            action: "game-connect.voucher.minted",
            entity: "game-server",
            entityId: server.gameServerId,
            metadata: { amount: body.amount, actor: body.actor.name, voucher: minted.voucherId },
        }).catch(() => {});
        return ok(minted);
    });
});
