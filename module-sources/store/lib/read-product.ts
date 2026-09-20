/**
 * One product as a visitor may see it.
 *
 * The page that shows a product is a client component and fetched it on mount,
 * so not a word of a product - not its name, not its description, not its
 * price - was ever in the HTML the server sent. All 34 product URLs the
 * sitemap publishes were empty pages to a reader without JavaScript and to
 * anything that indexes one.
 *
 * The page renders this on the server now and the endpoint still calls it, so
 * the rules about what a visitor may see are written once. Two of them matter:
 * a switched-off product never leaves the database, and a product an operator
 * asked to hide while it is shut answers exactly as one that does not exist,
 * so the two cannot be told apart.
 */
import { isAdmin, moduleSettings, prisma } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { PUBLIC_PRODUCT } from "./public-product";
import { availabilityFor, type ProductRow } from "./availability-server";
import { effectivePrice } from "./availability";
import { priceAfterCredit, upgradeCredit } from "./upgrade-credit";
import { creditingPurchases, ownedRungsOn } from "./upgrade-credit-server";

export type ProductRead = Awaited<ReturnType<typeof readProduct>>;

export async function readProduct(id: string) {
    const product = await prisma.product.findFirst({
        where: {
            isActive: true,
            OR: [{ id }, { slug: id }, ...(isNaN(Number(id)) ? [] : [{ number: Number(id) }])],
        },
        select: PUBLIC_PRODUCT,
    });
    if (!product) return null;

    // Per-person counting needs the session, which is also why an answer built
    // here is never shared-cached the way the listing is.
    const session = await auth();
    const state = await availabilityFor(prisma, product as unknown as ProductRow, session?.user?.id ?? null);

    const hidden = product.outsideWindow === "hidden" && state.state !== "open" && state.state !== "limit_reached";
    if (hidden && !(session?.user?.id && (await isAdmin(session.user.id)))) return null;

    const { lowStockAt } = await moduleSettings<{ lowStockAt: number }>("store");

    // What this reader pays rather than what the product costs. Somebody
    // standing on a lower rung of the same ladder pays the difference, and
    // until now the only place that was true was the checkout.
    const ownedIds = await creditingPurchases(session?.user?.id);
    const ladder = await ownedRungsOn([product.category?.id], ownedIds);
    const credit = upgradeCredit(
        { id: product.id, categoryId: product.category?.id ?? null, price: state.price },
        ladder,
        ownedIds,
    );

    return {
        ...product,
        /*
         * A number, not a Decimal.
         *
         * `price` is replaced below with the one the window worked out, which
         * is already a number; `comparePrice` and `salePrice` came straight
         * off the row. Over HTTP they arrived as strings, which every screen
         * that reads them declared as `number` and multiplied - so the type
         * was a fiction the JSON boundary hid. Converted once, here.
         */
        comparePrice: product.comparePrice === null ? null : Number(product.comparePrice),
        salePrice: product.salePrice === null ? null : Number(product.salePrice),
        lowStockAt,
        availability: {
            state: state.state,
            buyable: state.buyable,
            opensAt: state.opensAt,
            closesAt: state.closesAt,
            remainingForPerson: state.remainingForPerson,
            remainingInPeriod: state.remainingInPeriod,
        },
        price: priceAfterCredit(state.price, credit),
        was: state.was,
        onSale: state.onSale,
        /** Taken off because a cheaper rung on this ladder is already owned. */
        upgradeCredit: credit,
        /** What it costs somebody who owns nothing on this shelf. */
        fullPrice: state.price,
    };
}
