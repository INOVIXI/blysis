/**
 * Tells connected servers that somebody bought credits, for those that
 * announce it.
 *
 * The name is the member's username: the event goes to every server, and a
 * game account belongs to one game, so the name every server can say is the
 * site's own.
 */
import { log, prisma } from "@/core/sdk/server";
import { emitEvent } from "../lib/events";

/** The store's payload, spelled out: this module does not depend on the store. */
interface CreditsPurchased {
    userId?: string;
    amount?: number;
}

const onCreditsPurchased = async (purchase: CreditsPurchased): Promise<void> => {
    try {
        const amount = Number(purchase?.amount);
        if (!purchase?.userId || !(amount > 0)) return;
        const user = await prisma.user.findUnique({ where: { id: purchase.userId }, select: { username: true } });
        await emitEvent("topup", { player: user?.username ?? null, amount });
    } catch (error) {
        log.warn("[game-connect] a credit purchase could not be announced", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
};

export default onCreditsPurchased;
