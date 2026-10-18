/**
 * Where each order's delivery stands, asked of whichever module queues
 * deliveries. Without one, every order answers nothing and the screens show
 * the order's own status alone, as they always did.
 */
import { applyFiltersAsync } from "@/core/sdk";
import { log } from "@/core/sdk/server";

export async function deliveryOf(orderIds: string[]): Promise<Record<string, OrderDelivery>> {
    if (orderIds.length === 0) return {};
    try {
        return (await applyFiltersAsync("store.orders.delivery", {}, { orderIds })) ?? {};
    } catch (error) {
        // A screen of orders must still open when the delivery side is down.
        log.warn("[store] delivery state unavailable", { error: error instanceof Error ? error.message : String(error) });
        return {};
    }
}
