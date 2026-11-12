/**
 * Banking a creator's cut of an order, once the order is paid.
 *
 * It used to be paid when a gateway checkout wrote its order, before any money
 * moved, so every checkout started with a code and never paid earned its
 * creator a commission. It is paid where the order is: in the transaction that
 * completes it, a credits checkout's or a settlement's, so a retried webhook
 * that loses the claim pays nothing a second time.
 */
import { applyFiltersAsync } from "@/core/sdk";
import type { PrismaTransaction } from "@/core/sdk/server";
import { computeCreatorCommission } from "./pricing";

export interface CommissionCode {
    id: string;
    code: string;
    creatorId: string;
    commissionPercent: number;
}

/** Counts the use and credits the creator, on the caller's transaction. */
export async function payCreatorCommission(tx: PrismaTransaction, code: CommissionCode, total: number, orderNumber: string) {
    await tx.creatorCode.update({
        where: { id: code.id },
        data: { usageCount: { increment: 1 }, totalRevenue: { increment: total } },
    });
    await applyFiltersAsync("credit.change", { applied: false }, {
        tx,
        userId: code.creatorId,
        amount: computeCreatorCommission(total, code.commissionPercent),
        type: "creator_commission",
        description: `Commission for order ${orderNumber} via code ${code.code}`,
    });
}

/**
 * The commission for a gateway order being settled, from the code checkout
 * recorded on it. Nothing when it was placed without one, or the code or its
 * creator is gone since.
 */
export async function payCommissionFor(
    tx: PrismaTransaction,
    order: { metadata: unknown; total: unknown; orderNumber: string },
) {
    const recorded = (order.metadata as { creatorCode?: unknown } | null)?.creatorCode;
    if (typeof recorded !== "string" || recorded === "") return;
    const code = await tx.creatorCode.findUnique({
        where: { code: recorded },
        select: { id: true, code: true, creatorId: true, commissionPercent: true },
    });
    if (!code?.creatorId) return;
    await payCreatorCommission(tx, { ...code, creatorId: code.creatorId }, Number(order.total), order.orderNumber);
}
