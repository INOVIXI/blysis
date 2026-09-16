/**
 * Answers `store.orders.collect`: what this shop sold in a window.
 *
 * An accounting integrator asks the site for its sales between two dates.
 * Answering used to be the integrator's own job, with its own query against
 * `Order` - a module that files invoices knowing the shop's status
 * vocabulary, its line item columns and where the buyer's email lives.
 *
 * Paid orders unless the caller names another state, because an unpaid order
 * is not a sale and invoicing one is a document to cancel later.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";

const collectOrders: HookHandlerFor<"store.orders.collect", "filter"> = async (current, window) => {
    if (current.length > 0) return current;

    const orders = await prisma.order.findMany({
        where: {
            // The caller names a state in the shop's own words; an unknown one
            // matches nothing rather than throwing at them.
            status: (window.status ?? "COMPLETED") as never,
            ...(window.from || window.until
                ? {
                      createdAt: {
                          ...(window.from ? { gte: window.from } : {}),
                          ...(window.until ? { lte: window.until } : {}),
                      },
                  }
                : {}),
        },
        include: {
            items: { select: { id: true, productId: true, name: true, quantity: true, price: true } },
            user: { select: { email: true } },
        },
        orderBy: { createdAt: "asc" },
        take: window.limit,
    });

    return orders.map((order) => ({
        id: order.id,
        // The integer an integrator holds; see the field's own comment in
        // hooks.d.ts and store migration 014.
        number: order.number,
        userId: order.userId,
        orderNumber: order.orderNumber,
        status: order.status,
        total: order.total,
        // What the goods came to, and what came off.
        subtotal: order.subtotal,
        discount: order.discount,
        currency: order.currency,
        paymentMethod: order.paymentMethod,
        metadata: order.metadata,
        createdAt: order.createdAt,
        billingDetails: order.billingDetails,
        buyerEmail: order.user?.email ?? null,
        items: order.items,
    }));
};

export default collectOrders;
