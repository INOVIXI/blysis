/**
 * Answers `store.order.completed`: an order that included a crate's key was
 * paid for, so the buyer gets the keys. See lib/keys.ts for why the same order
 * arriving twice gives them once.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { log, prisma } from "@/core/sdk/server";
import { grantKeysForOrder } from "../lib/keys";

const onOrderCompleted: HookHandlerFor<"store.order.completed", "action"> = async (order) => {
    try {
        await grantKeysForOrder(prisma, order);
    } catch (error) {
        // Logged loudly rather than thrown: the order is paid and delivered
        // either way, and the receipt row means a later announcement of the
        // same order can still add the keys without adding them twice.
        log.error("[crates] keys for a paid order could not be added", {
            orderId: order.id,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};

export default onOrderCompleted;
