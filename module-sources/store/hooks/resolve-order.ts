/**
 * Answers `store.order.resolve`: which order a caller means.
 *
 * An invoicing module is handed back the reference it was given and has to
 * say which sale the document belongs to. Doing that itself meant knowing
 * three columns of the shop's `Order` - the cuid, the human-facing number and
 * the integer an integrator needs - and a shop replaced by another would have
 * left it resolving nothing.
 *
 * Null is an answer. The caller refuses rather than guessing, which is the
 * only safe thing to do with a document that belongs to a sale nobody here
 * has.
 */
import type { HookHandlerFor } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";

const resolveOrder: HookHandlerFor<"store.order.resolve", "filter"> = async (current, asked) => {
    if (current) return current;

    const reference = asked.reference;
    const found = typeof reference === "number"
        ? await prisma.order.findUnique({ where: { number: reference }, select: { id: true } })
        : await prisma.order.findFirst({
            where: { OR: [{ id: reference }, { orderNumber: reference }] },
            select: { id: true },
        });

    return found?.id ?? null;
};

export default resolveOrder;
