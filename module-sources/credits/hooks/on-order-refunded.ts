/**
 * Taking back the cashback a refunded order earned.
 *
 * Cashback is paid on money that arrived (`cashback.ts`). A refund or a
 * chargeback is that money leaving again, and the credits it earned were
 * spendable all the same. The award's ledger row is keyed on the order, so
 * the amount is read from it rather than worked out again from a rate that
 * may have changed since.
 *
 * Only as far as the balance still holds it: a debit the balance cannot cover
 * is refused outright by `moveCredits`, so whatever was already spent is
 * logged rather than left untaken in full. The reversal has its own
 * deterministic id, so a second notice of the same refund takes nothing.
 */
import { log, prisma } from "@/core/sdk/server";
import { awardLedgerId } from "../lib/award";
import { moveCredits } from "./change";

/** The part of a refunded order this reads. See `on-order-completed.ts` for why it is stated here. */
interface RefundedOrder {
    id: string;
    userId: string | null;
    orderNumber: string;
}

const onOrderRefunded = async (order: RefundedOrder): Promise<void> => {
    if (!order.userId) return;
    const userId = order.userId;

    const awarded = await prisma.creditTransaction.findUnique({
        where: { id: awardLedgerId("cashback", order.id) },
        select: { amount: true },
    });
    const earned = Number(awarded?.amount ?? 0);
    if (earned <= 0) return;

    try {
        const taken = await prisma.$transaction(async (tx) => {
            const holder = await tx.user.findUnique({ where: { id: userId }, select: { creditBalance: true } });
            const take = Math.min(earned, Math.max(0, Math.floor(Number(holder?.creditBalance ?? 0))));
            if (take <= 0) return 0;
            await moveCredits(tx, {
                userId,
                amount: -take,
                type: "payment_refund",
                description: `Cashback taken back: order ${order.orderNumber} was refunded`,
                ledgerId: awardLedgerId("payment_refund", order.id),
            });
            return take;
        });
        if (taken < earned) {
            log.warn("[credits] cashback on a refunded order was already spent", {
                orderId: order.id,
                earned,
                taken,
            });
        }
    } catch (err) {
        // P2002: this refund was already taken back.
        if (err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === "P2002") return;
        log.error("[credits] cashback on a refunded order could not be taken back", {
            orderId: order.id,
            error: err instanceof Error ? err.message : String(err),
        });
    }
};

export default onOrderRefunded;
