/**
 * Banking a creator's cut of an order, once the order is paid.
 *
 * It used to be paid when a gateway checkout wrote its order, before any money
 * moved, so every checkout started with a code and never paid earned its
 * creator a commission. It is paid where the order is: in the transaction that
 * completes it, a credits checkout's or a settlement's, so a retried webhook
 * that loses the claim pays nothing a second time.
 */
import type { Prisma } from "@prisma/client";
import { applyFiltersAsync } from "@/core/sdk";
import { log, type PrismaTransaction } from "@/core/sdk/server";
import { computeCreatorCommission } from "./pricing";

export interface CommissionCode {
    id: string;
    code: string;
    creatorId: string;
    commissionPercent: number;
}

/** What an order paid its creator, as written on the order so a refund can take it back. */
export interface PaidCommission {
    codeId: string;
    creatorId: string;
    /** What the wallet took in. Nothing when no wallet answered. */
    amount: number;
    /** The order total the code's counters were raised by. */
    total: number;
}

/**
 * Counts the use and credits the creator, on the caller's transaction.
 * Answers what was paid, which is nothing when no wallet took the credit.
 */
export async function payCreatorCommission(
    tx: PrismaTransaction,
    code: CommissionCode,
    total: number,
    orderNumber: string,
): Promise<PaidCommission> {
    await tx.creatorCode.update({
        where: { id: code.id },
        data: { usageCount: { increment: 1 }, totalRevenue: { increment: total } },
    });
    const amount = computeCreatorCommission(total, code.commissionPercent);
    const moved = await applyFiltersAsync("credit.change", { applied: false }, {
        tx,
        userId: code.creatorId,
        amount,
        type: "creator_commission",
        description: `Commission for order ${orderNumber} via code ${code.code}`,
    });
    return { codeId: code.id, creatorId: code.creatorId, amount: moved.applied ? amount : 0, total };
}

/**
 * The commission for a gateway order being settled, from the code checkout
 * recorded on it. Nothing when it was placed without one, or the code or its
 * creator is gone since.
 */
export async function payCommissionFor(
    tx: PrismaTransaction,
    order: { id: string; metadata: unknown; total: unknown; orderNumber: string },
) {
    const recorded = (order.metadata as { creatorCode?: unknown } | null)?.creatorCode;
    if (typeof recorded !== "string" || recorded === "") return;
    const code = await tx.creatorCode.findUnique({
        where: { code: recorded },
        select: { id: true, code: true, creatorId: true, commissionPercent: true },
    });
    if (!code?.creatorId) return;
    const paid = await payCreatorCommission(tx, { ...code, creatorId: code.creatorId }, Number(order.total), order.orderNumber);
    // The wallet's ledger does not say which order a row was for, and the
    // code's percentage can change after the sale. What was paid is written
    // down here, in the same transaction, so a refund takes back that and no
    // more.
    await tx.order.update({
        where: { id: order.id },
        data: { metadata: { ...asRecord(order.metadata), commissionPaid: { ...paid } } as Prisma.InputJsonObject },
    });
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The ledger id of the take-back: one refund of one order, so a repeat is a duplicate key. */
function commissionRefundLedgerId(orderId: string): string {
    return `commission-refund:${orderId}`;
}

/**
 * Takes back the commission a refunded order paid its creator, on the
 * refund's own transaction, so a second notice of the same refund takes
 * nothing twice.
 *
 * Only an order that wrote down a payment is touched. The code's counters go
 * back with it. The credits come back as far as the creator still holds them,
 * the way a refunded order's cashback does: the wallet refuses a debit it
 * cannot cover rather than going negative, so the part already spent is
 * logged and stays spent.
 */
export async function takeBackCommission(tx: PrismaTransaction, order: { id: string; orderNumber: string; metadata: unknown }) {
    const paid = asRecord(order.metadata).commissionPaid as PaidCommission | undefined;
    if (!paid || typeof paid.codeId !== "string") return;

    // A code deleted since has nothing to count back; the update then touches no row.
    await tx.creatorCode.updateMany({
        where: { id: paid.codeId, usageCount: { gt: 0 } },
        data: { usageCount: { decrement: 1 }, totalRevenue: { decrement: paid.total } },
    });
    if (!(paid.amount > 0)) return;

    const held = await applyFiltersAsync("credits.balance", null as number | null, { userId: paid.creatorId });
    const take = Math.min(paid.amount, Math.floor(Math.max(0, held ?? 0) * 100) / 100);
    const moved =
        take > 0 &&
        (await applyFiltersAsync("credit.change", { applied: false }, {
            tx,
            userId: paid.creatorId,
            amount: -take,
            type: "creator_commission",
            description: `Commission taken back: order ${order.orderNumber} was refunded`,
            ledgerId: commissionRefundLedgerId(order.id),
        })).applied;
    if (!moved || take < paid.amount) {
        log.warn("[store] the commission on a refunded order was already spent", {
            orderId: order.id,
            paid: paid.amount,
            takenBack: moved ? take : 0,
        });
    }
}
