/**
 * Answers `product.grant`: somebody is being handed a thing, and the shop is
 * what a thing means here.
 *
 * It goes to the chest, which is where a purchase waits to be claimed and
 * already anticipates a row nobody bought - an item an operator put there by
 * hand carries no player name and is asked for one at claim time. A prize is
 * exactly that: it arrives without a checkout behind it.
 *
 * Written on the caller's transaction, so the thing and whatever promised it
 * commit together. A wheel that announced a key and then failed to write one
 * is a support ticket with the key's name in it.
 *
 * A product that has since been switched off is refused rather than granted:
 * an operator took it off the shelf, and handing one out is the shelf.
 */
import type { HookHandlerFor } from "@/core/sdk";

const grantProduct: HookHandlerFor<"product.grant", "filter"> = async (current, request) => {
    if (current?.granted) return current;
    if (!request?.tx || !request.userId || !request.productId) return { granted: false };

    const product = await request.tx.product.findFirst({
        where: { id: request.productId, isActive: true },
        select: { id: true, name: true },
    });
    if (!product) return { granted: false };

    await request.tx.chestItem.create({
        data: {
            userId: request.userId,
            productId: product.id,
            productName: product.name,
            quantity: Math.max(1, Math.trunc(request.quantity ?? 1)),
            // Nobody has said who it is for. The claim step asks, which is the
            // case the chest was built around.
            playerName: null,
        },
    });

    return { granted: true, name: product.name };
};

export default grantProduct;
