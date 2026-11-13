/**
 * Answers `credit.change`: the one place a credit balance moves.
 *
 * A spend is an `updateMany` with the balance in the `where`, so two requests
 * that both read "enough" cannot both succeed: the second updates no rows and
 * this answers `applied: false`. That guard was written three times in three
 * modules, and each of them also wrote the ledger row beside it.
 *
 * Everything happens on the caller's transaction. If whatever they were
 * paying for fails after this, their rollback takes the movement with it.
 */
import type { HookHandlerFor } from "@/core/sdk";
import type { PrismaTransaction } from "@/core/sdk/server";

/**
 * The movement itself, so `credits.award` and `credit.change` write a balance
 * and its ledger row the same way rather than twice.
 */
export async function moveCredits(
    tx: PrismaTransaction,
    movement: { userId: string | null; amount: number; type: string; description?: string | null; ledgerId?: string },
    /**
     * Let a debit take the balance below zero, from the balance the caller
     * read. Only an operator changing a balance by hand asks for it
     * (`lib/adjust.ts`), for a chargeback on credits already spent. A third
     * argument rather than a field of the movement, so nothing that asks
     * `credit.change` can pass it along.
     */
    options: { negativeFrom?: number } = {},
): Promise<boolean> {
    const { userId, amount } = movement;

    // Nobody holds it: the row is the whole record. This is the site's own
    // cut of a sale, which leaves circulation rather than landing anywhere.
    if (!userId) {
        await tx.creditTransaction.create({
            data: {
                ...(movement.ledgerId ? { id: movement.ledgerId } : {}),
                userId: null,
                amount,
                type: movement.type,
                description: movement.description ?? null,
            },
        });
        return true;
    }

    if (amount < 0) {
        // Conditional, always. Two requests that both read "enough" must not
        // both succeed, and no automatic caller has a reason to take credits
        // somebody does not have. An operator who allowed a debt allowed the
        // one they were shown: the balance must still hold what they read,
        // so a spend that lands between the read and this debit refuses the
        // change rather than leaving a deeper debt nobody agreed to.
        const debit = Math.abs(amount);
        const mustHold = options.negativeFrom === undefined ? debit : Math.min(debit, options.negativeFrom);
        const debited = await tx.user.updateMany({
            where: { id: userId, creditBalance: { gte: mustHold } },
            data: { creditBalance: { decrement: debit } },
        });
        if (debited.count === 0) return false;
    } else {
        await tx.user.update({ where: { id: userId }, data: { creditBalance: { increment: amount } } });
    }

    await tx.creditTransaction.create({
        data: {
            // A duplicate here is the point: see `ledgerId` in the contract.
            ...(movement.ledgerId ? { id: movement.ledgerId } : {}),
            userId,
            amount,
            type: movement.type,
            description: movement.description ?? null,
        },
    });

    return true;
}

const changeCredit: HookHandlerFor<"credit.change", "filter"> = async (current, movement) => {
    if (current?.applied) return current;
    if (!movement?.tx || !movement.amount) return { applied: false };
    return { applied: await moveCredits(movement.tx, movement) };
};

export default changeCredit;
