/**
 * Answers `store.order.refunded`: the money for a key went back, so the keys
 * it bought that are still unspent go back too. See lib/keys.ts.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { log, prisma } from "@/core/sdk/server";
import { revokeKeysForOrder } from "../lib/keys";

const onOrderRefunded: HookHandlerFor<"store.order.refunded", "action"> = async (order) => {
    try {
        await revokeKeysForOrder(prisma, order);
    } catch (error) {
        log.error("[crates] keys from a refunded order could not be taken back", {
            orderId: order.id,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};

export default onOrderRefunded;
