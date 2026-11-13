/**
 * An operator adding credits to a member's balance or taking them off, by
 * hand, with a reason.
 *
 * The only way to do this from the site was an endpoint nothing called: it
 * could add and not remove, took no reason, and the ledger row it wrote said
 * "Admin granted 100 credits" whoever did it and whyever. A balance an
 * operator changed is the one a member is most likely to ask about, so the
 * reason is required and written on the row the member reads, and who made
 * the change goes to the activity log.
 *
 * A removal stops at zero like every other debit (`moveCredits`), because a
 * negative balance is a debt the site has to collect. Taking a member below
 * zero, for a chargeback on credits they already spent, is a separate choice
 * the operator makes on purpose with `allowNegative`.
 *
 * Guarded by `tests/modules/credits/an-operator-changes-a-balance-with-a-reason.test.ts`.
 */
import type { PrismaTransaction } from "@/core/sdk/server";
import { moveCredits } from "../hooks/change";

/** The ledger words for a change by hand, the same ones the in-game staff command writes. */
export const ADMIN_GRANT = "admin_grant";
export const ADMIN_REMOVE = "admin_remove";

/** The most one change may move either way. */
export const MAX_ADJUSTMENT = 1_000_000;

export interface Adjustment {
    userId: string;
    /** Positive adds, negative removes. A whole number of credits, never zero. */
    amount: number;
    reason: string;
    allowNegative?: boolean;
}

export type AdjustmentRefusal = "credits_adjust_zero" | "credits_adjust_too_large" | "credits_adjust_no_reason" | "credits_adjust_below_zero";

/**
 * Why a change cannot be made against this balance, or null when it can.
 *
 * The same rule the transaction enforces, asked first so a refusal can say
 * which rule it was. It is a snapshot; `adjustBalance` decides again under the
 * row's own condition.
 */
export function adjustmentRefusal(adjustment: Omit<Adjustment, "userId">, balance: number): AdjustmentRefusal | null {
    if (!Number.isInteger(adjustment.amount) || adjustment.amount === 0) return "credits_adjust_zero";
    if (Math.abs(adjustment.amount) > MAX_ADJUSTMENT) return "credits_adjust_too_large";
    if (adjustment.reason.trim() === "") return "credits_adjust_no_reason";
    if (adjustment.amount < 0 && !adjustment.allowNegative && balance + adjustment.amount < 0) {
        return "credits_adjust_below_zero";
    }
    return null;
}

/**
 * Moves the balance and writes the row that explains it, on the caller's
 * transaction. Answers false when a removal would take the balance below
 * zero and that was not allowed: the conditional debit in `moveCredits`
 * found the balance short, whatever a read before it said.
 */
export async function adjustBalance(tx: PrismaTransaction, adjustment: Adjustment): Promise<boolean> {
    return moveCredits(
        tx,
        {
            userId: adjustment.userId,
            amount: adjustment.amount,
            type: adjustment.amount > 0 ? ADMIN_GRANT : ADMIN_REMOVE,
            description: adjustment.reason.trim(),
        },
        { allowNegative: adjustment.allowNegative === true && adjustment.amount < 0 },
    );
}
