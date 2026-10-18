/**
 * Credits turned into something a player can hand over.
 *
 * The voucher is its id: an item in game only carries it, so copying the item
 * copies a reference, and the reference redeems once. Redeeming marks the row
 * used with a write conditional on it being unused, inside the same
 * transaction as the credit, so two redemptions of one id cannot both pay.
 */
import crypto from "crypto";
import { prisma } from "@/core/sdk/server";
import { moveCredits } from "./bridge";

export function newVoucherId(): string {
    return `gv_${crypto.randomBytes(18).toString("base64url")}`;
}

export type VoucherCreated = { ok: true; voucherId: string; amount: number } | { ok: false; code: "insufficient_balance" };

/** Takes the amount from the member and writes the voucher, or neither. */
export async function createVoucher(userId: string, amount: number, serverId: string): Promise<VoucherCreated> {
    const voucherId = newVoucherId();
    const made = await prisma.$transaction(async (tx) => {
        const taken = await moveCredits(tx, {
            userId,
            amount: -amount,
            type: "voucher_create",
            description: `Voucher of ${amount} credits`,
        });
        if (!taken) return false;
        await tx.gameConnectVoucher.create({
            data: { id: voucherId, amount, origin: "player", createdById: userId, createdOnServer: serverId },
        });
        return true;
    });
    return made ? { ok: true, voucherId, amount } : { ok: false, code: "insufficient_balance" };
}

/** A voucher nobody paid for, minted by staff on a server allowed to. */
export async function mintVoucher(amount: number, serverId: string): Promise<{ voucherId: string; amount: number }> {
    const voucherId = newVoucherId();
    await prisma.gameConnectVoucher.create({ data: { id: voucherId, amount, origin: "admin", createdOnServer: serverId } });
    return { voucherId, amount };
}

export type VoucherRedeemed =
    | { ok: true; amount: number }
    | { ok: false; code: "not_found" }
    | { ok: false; code: "voucher_used"; usedAt: string | null };

export async function redeemVoucher(voucherId: string, userId: string): Promise<VoucherRedeemed> {
    const voucher = await prisma.gameConnectVoucher.findUnique({ where: { id: voucherId } });
    if (!voucher) return { ok: false, code: "not_found" };
    if (voucher.redeemedAt) return { ok: false, code: "voucher_used", usedAt: voucher.redeemedAt.toISOString() };

    const amount = Number(voucher.amount);
    const paid = await prisma.$transaction(async (tx) => {
        const claimed = await tx.gameConnectVoucher.updateMany({
            where: { id: voucherId, redeemedAt: null },
            data: { redeemedAt: new Date(), redeemedById: userId },
        });
        if (claimed.count === 0) return false;
        const credited = await moveCredits(tx, {
            userId,
            amount,
            type: "voucher_redeem",
            description: `Voucher of ${amount} credits redeemed`,
        });
        if (!credited) throw new Error("credit not recorded");
        return true;
    });
    if (!paid) {
        const again = await prisma.gameConnectVoucher.findUnique({ where: { id: voucherId }, select: { redeemedAt: true } });
        return { ok: false, code: "voucher_used", usedAt: again?.redeemedAt?.toISOString() ?? null };
    }
    return { ok: true, amount };
}
