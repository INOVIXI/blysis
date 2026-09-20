import { priceAfterCredit, upgradeCredit } from "./upgrade-credit";

/**
 * What the basket costs this buyer, worked out once.
 *
 * The cart screen and the coupon preview both have to answer it, and they
 * answered it apart: the screen applied the upgrade credit and the preview
 * took whatever number the browser sent it. So the shop's own idea of what a
 * basket was worth depended on which request asked, and a coupon's minimum
 * purchase was checked against a figure the buyer's page had computed.
 *
 * Bulk discounts are deliberately not here. The cart has never shown them and
 * the till has always taken them, which is a gap of its own; closing it means
 * the cart quoting a lower number than it does today, and that is a change to
 * what a shopper is shown rather than a correction to arithmetic.
 */

export interface CartLine {
    productId: string;
    categoryId: string | null;
    price: number;
    quantity: number;
}

export interface PricedCartLine extends CartLine {
    /** Taken off because a cheaper rung of the same ladder is already owned. */
    upgradeCredit: number;
    /** What this line costs after that credit. */
    payPrice: number;
}

export function priceCartLines(
    lines: readonly CartLine[],
    ownedIds: ReadonlySet<string>,
): { lines: PricedCartLine[]; subtotal: number } {
    const ladder = lines.map((line) => ({
        id: line.productId,
        categoryId: line.categoryId,
        price: line.price,
    }));

    const priced = lines.map((line) => {
        const credit = upgradeCredit(
            { id: line.productId, categoryId: line.categoryId, price: line.price },
            ladder,
            ownedIds,
        );
        return { ...line, upgradeCredit: credit, payPrice: priceAfterCredit(line.price, credit) };
    });

    return {
        lines: priced,
        subtotal: priced.reduce((sum, line) => sum + line.payPrice * line.quantity, 0),
    };
}
