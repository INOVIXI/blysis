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
 */
import { moduleSettings, prisma } from "@/core/sdk/server";
import { stillOwnedWhere } from "./ownership";

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
    return new Set(owned.map((row) => row.productId));
}
