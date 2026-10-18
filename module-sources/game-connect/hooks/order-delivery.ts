/**
 * Answers `store.orders.delivery`: where each order's queued deliveries stand,
 * so the store's order screens say "waiting for you in game" rather than a
 * bare "paid". The shapes are spelled out because the hook belongs to a module
 * this one does not depend on.
 */
import { prisma } from "@/core/sdk/server";
import { summarise, type DeliveryState } from "../lib/order-delivery";

type OrderDeliveries = Record<string, { state: DeliveryState; lines: Record<string, DeliveryState> }>;

/** A page of orders is what asks; a longer list is cut rather than read whole. */
const MOST_ORDERS = 100;

const orderDelivery = async (current: OrderDeliveries, context: { orderIds?: string[] }): Promise<OrderDeliveries> => {
    const ids = (context?.orderIds ?? []).slice(0, MOST_ORDERS);
    if (ids.length === 0) return current ?? {};
    const jobs = await prisma.gameConnectJob.findMany({
        where: { referenceKind: "order", referenceId: { in: ids } },
        select: { referenceId: true, groupKey: true, state: true },
        take: ids.length * 50,
    });
    return { ...(current ?? {}), ...summarise(jobs) };
};

export default orderDelivery;
