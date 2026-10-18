/**
 * Tells connected servers about a purchase, for those that announce it.
 *
 * The name is the one the buyer typed for delivery, else their username: the
 * same name the store's own recent-purchases widget shows, so nothing is said
 * in game that the site does not already say in public.
 */
import { log, prisma } from "@/core/sdk/server";
import { communityGoal } from "../lib/bridge";
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
    total?: unknown;
    items?: { name: string; quantity: number }[];
}

/**
 * The goal is reached by the order that crosses it, and said once a month.
 * Two orders crossing it together both see it crossed, so the month's
 * announcement is looked for before another is written.
 */
async function announceGoal(order: CompletedOrder, now: Date): Promise<void> {
    const goal = await communityGoal();
    if (!goal || goal.target <= 0 || goal.current < goal.target) return;
    const total = Number(order.total) || 0;
    if (goal.current - total >= goal.target) return;

    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const said = await prisma.gameConnectEvent.findFirst({
        where: { type: "goal.reached", data: { path: ["month"], equals: month } },
        select: { seq: true },
    });
    if (said) return;
    await emitEvent("goal.reached", { title: goal.title, target: goal.target, current: goal.current, month });
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
        await announceGoal(order, new Date());
    } catch (error) {
        log.warn("[game-connect] a purchase could not be announced", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
};

export default onOrderCompleted;
