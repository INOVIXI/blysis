/**
 * Tells connected servers about a purchase, for those that announce it.
 *
 * The name is the one the buyer typed for delivery, else their username: the
 * same name the store's own recent-purchases widget shows, so nothing is said
 * in game that the site does not already say in public.
 */
import { log } from "@/core/sdk/server";
import { emitEvent } from "../lib/events";

function playerOf(metadata: unknown): string | null {
    if (metadata && typeof metadata === "object" && "playerName" in metadata) {
        const name = (metadata as { playerName?: unknown }).playerName;
        if (typeof name === "string" && name.trim() !== "") return name.trim();
    }
    return null;
}

/**
 * The part of the store's order this reads. Spelled out rather than typed
 * through the store's declaration: this module does not depend on the store,
 * so it has to build on a site that has none.
 */
interface CompletedOrder {
    metadata?: unknown;
    items?: { name: string; quantity: number }[];
}

const onOrderCompleted = async (order: CompletedOrder): Promise<void> => {
    try {
        const items = order.items ?? [];
        if (items.length === 0) return;
        const first = items[0];
        await emitEvent("purchase", {
            player: playerOf(order.metadata),
            product: first.name,
            quantity: first.quantity,
            more: items.length - 1,
        });
    } catch (error) {
        log.warn("[game-connect] a purchase could not be announced", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
};

export default onOrderCompleted;
