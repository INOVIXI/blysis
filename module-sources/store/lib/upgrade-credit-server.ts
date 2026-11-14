/**
 * Which of a buyer's purchases count toward an upgrade, right now.
 *
 * Empty for a visitor who is not signed in, and empty when the operator has
 * turned the credit off - both mean "nothing to trade in", so no screen needs
 * a second branch for either. A caller that forgot the setting would show a
 * price the checkout does not charge, which is the failure this whole change
 * is about.
 *
 * A lapsed purchase stops crediting: `stillOwnedWhere` is the filter and it is
 * in the query rather than applied afterwards, so it cannot be left out.
 *
 * Only a product on a shelf drawn as a comparison table counts. That layout is
 * how an operator says a shelf is a ladder; a grid of crate keys is not one,
 * and a key bought once used to come off every dearer key after it.
 */
import { moduleSettings, prisma } from "@/core/sdk/server";
import { stillOwnedWhere } from "./ownership";
import { effectivePrice } from "./availability";
import { withStoreSale } from "./store-sale";
import { runningStoreSales } from "./store-sale-server";
import type { UpgradeCandidate } from "./upgrade-credit";

export async function creditingPurchases(userId: string | null | undefined): Promise<Set<string>> {
    if (!userId) return new Set();

    const { enableUpgradeCredit } = await moduleSettings<{ enableUpgradeCredit: boolean }>("store");
    // Absent means on: the credit worked before there was a switch, and a shop
    // that has never opened the settings screen has no row.
    if (enableUpgradeCredit === false) return new Set();

    const owned = await prisma.ownedProduct.findMany({
        where: stillOwnedWhere(userId, new Date()),
        select: { productId: true },
        // A ladder is a handful of rungs; a shop with more owned products than
        // this is not one this credit can say anything useful about.
        take: 500,
    });
    if (owned.length === 0) return new Set();

    const rungs = await prisma.product.findMany({
        where: { id: { in: owned.map((row) => row.productId) }, category: { layout: "table" } },
        select: { id: true },
    });
    return new Set(rungs.map((row) => row.id));
}

/**
 * The rungs this buyer already stands on, on the shelves these products are.
 *
 * The credit is worked out against a ladder, and the rung somebody owns is
 * exactly the thing that is not in their basket: a shopper upgrading to VIP+
 * has VIP behind them, not beside it. The cart, the coupon preview and the
 * checkout each built the ladder from the basket, so the credit could only
 * fire for somebody who had put a product they already own into the basket
 * alongside the one above it. Measured on 2026-09-20: the shelf quoted 10.00
 * and the till took 19.99.
 *
 * Only owned products, because only an owned product can credit anything -
 * the shelf itself is a larger query for no more answers.
 *
 * Bounded, and by the ownership set as well as the shelf: a ladder is a
 * handful of rungs, and a shop where this returns two hundred rows is not one
 * this credit can say anything useful about.
 */
export async function ownedRungsOn(
    categoryIds: readonly (string | null | undefined)[],
    ownedIds: ReadonlySet<string>,
    now: Date = new Date(),
): Promise<UpgradeCandidate[]> {
    const shelves = [...new Set(categoryIds.filter((id): id is string => Boolean(id)))];
    if (shelves.length === 0 || ownedIds.size === 0) return [];

    const rows = await prisma.product.findMany({
        where: { categoryId: { in: shelves }, isActive: true, id: { in: [...ownedIds] } },
        select: { id: true, categoryId: true, price: true, salePrice: true, saleFrom: true, saleUntil: true },
        take: 200,
    });

    // Only read when somebody owns a rung here, which is the rare case.
    const storeSales = rows.length > 0 ? await runningStoreSales(now) : [];
    return rows.map((row) => ({
        id: row.id,
        categoryId: row.categoryId,
        // The price the shelf credits against: a sale on the rung somebody
        // owns is what they actually put toward the one above it, and a
        // store-wide sale lowers it as it lowers the rung they are buying,
        // as the shelf draws both.
        price: withStoreSale(
            effectivePrice(
                {
                    price: Number(row.price),
                    salePrice: row.salePrice === null ? null : Number(row.salePrice),
                    saleFrom: row.saleFrom,
                    saleUntil: row.saleUntil,
                },
                now,
            ),
            { listPrice: Number(row.price), categoryId: row.categoryId },
            storeSales,
            now,
        ).price,
    }));
}
