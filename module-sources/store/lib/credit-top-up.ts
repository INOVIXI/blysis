/**
 * A wallet top-up, settled from the row the store wrote when it started.
 *
 * The credits, the buyer and the price used to travel through the gateway as
 * metadata and come back the same way. Eight gateways have nowhere to carry
 * metadata, so their top-ups came back as an order nobody had placed and
 * credited nothing; on the gateways that do carry it, the store was trusting a
 * provider's echo for how much to put on an account. Every top-up is now a
 * `CreditTopUp` row, its id is the reference the gateway carries, and settling
 * one reads everything from the row.
 */
import { prisma, log } from "@/core/sdk/server";
import { applyFiltersAsync, doActionAsync } from "@/core/sdk";
import { chargeShortfall } from "./charge";
import { ALREADY, OK, failed, refused } from "./payment-outcome";

/** The columns of a `CreditTopUp` that settling one reads. */
export interface TopUpRow {
    id: string;
    userId: string | null;
    credits: number;
    amount: number | { toString(): string };
    currency: string;
    status: string;
}

/**
 * The ledger row id for one top-up.
 *
 * Deterministic on purpose: it is the idempotency key, enforced by the primary
 * key rather than by a search that two callers can both lose.
 */
function creditLedgerId(provider: string, providerRef: string): string {
    return `credit:${provider}:${providerRef}`;
}

export async function findTopUp(reference: string): Promise<TopUpRow | null> {
    return prisma.creditTopUp.findUnique({ where: { id: reference } });
}

/** Puts the credits a top-up sold on its buyer's account, once. */
export async function settleCredits(settlement: PaymentSettlement, topUp: TopUpRow): Promise<PaymentOutcome> {
    if (topUp.status === "COMPLETED") return ALREADY;
    if (!topUp.userId) return failed("the account that bought these credits no longer exists");
    const userId = topUp.userId;

    const shortfall = chargeShortfall({ amount: Number(topUp.amount), currency: topUp.currency }, settlement);
    if (shortfall) {
        log.error("[store] a top-up was paid for with less than it cost", {
            topUpId: topUp.id,
            provider: settlement.provider,
            providerRef: settlement.providerRef,
            shortfall,
        });
        return refused(`payment does not match the top-up: ${shortfall}`);
    }

    // The gateway's own id for the money is the ledger row's primary key, and
    // the top-up is claimed in the same transaction: either closes a retry
    // racing a reloaded return URL, and the claim also closes one top-up
    // reported under two gateway ids.
    //
    // Looking for the ledger row first and writing after closed nothing: a
    // retry and a reload arriving together both found no row, and both
    // credited the account.
    const ledgerId = creditLedgerId(settlement.provider, settlement.providerRef);

    try {
        const credited = await prisma.$transaction(async (tx) => {
            const claimed = await tx.creditTopUp.updateMany({
                where: { id: topUp.id, status: "PENDING" },
                data: { status: "COMPLETED" },
            });
            if (claimed.count === 0) return false;
            // The wallet is another module's; the transaction is this one's,
            // and the deterministic id goes with the request so a duplicate
            // key still aborts it.
            await applyFiltersAsync("credit.change", { applied: false }, {
                tx,
                userId,
                amount: topUp.credits,
                type: "credit_purchase",
                description: `Purchased ${topUp.credits} credits via ${settlement.provider} (${settlement.providerRef})`,
                ledgerId,
            });
            return true;
        });
        if (!credited) return ALREADY;
    } catch (error) {
        // P2002 is the unique constraint: the other delivery won the race.
        if (error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === "P2002") {
            return ALREADY;
        }
        throw error;
    }

    // Told once, after the money is on the account: a retry that lost the
    // race above returned already and says nothing.
    await doActionAsync("store.credits.purchased", { userId, amount: topUp.credits }).catch((error: unknown) => {
        log.warn("[store] a credit purchase could not be announced", {
            error: error instanceof Error ? error.message : String(error),
        });
    });
    return OK;
}

/** The buyer walked away from a top-up. Nothing was credited, so nothing is undone. */
export async function cancelTopUp(topUp: TopUpRow): Promise<PaymentOutcome> {
    const cancelled = await prisma.creditTopUp.updateMany({
        where: { id: topUp.id, status: "PENDING" },
        data: { status: "CANCELLED" },
    });
    return cancelled.count === 0 ? ALREADY : OK;
}
