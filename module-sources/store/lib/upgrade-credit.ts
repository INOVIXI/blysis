/**
 * What somebody has already paid, put toward the next step up.
 *
 * A shop that sells a ladder sells the same thing five times: VIP, VIP+, MVP.
 * Charging the full price of the next rung to somebody standing on the one
 * below it charges them twice for the part they share, and every shop that
 * sells ranks answers this the same way - pay the difference.
 *
 * The rule lived inside `computeOrderPricing`, which is reached from exactly
 * one place: the checkout. So the credit was real and invisible. A buyer who
 * owned VIP saw 19.99 on the card, 19.99 on the product page, 19.99 in the
 * cart and 19.99 in the comparison table, and was charged 10.00. The pleasant
 * direction of that surprise is not the point: the price on the screen was not
 * the price, and nobody could discover the offer that was being made to them.
 *
 * So the arithmetic is here, once, and the five screens all ask it.
 *
 * Two decisions worth keeping:
 *
 * Within a category. A rank credits a rank; it does not credit a crate key.
 * The category is the shop's own grouping of "the same thing at different
 * levels", and it is the only grouping this module has.
 *
 * The highest one owned, not the sum of them. Somebody who bought VIP and then
 * VIP+ has paid 9.99 and 10.00; crediting both toward MVP would refund the
 * ladder they climbed. The rung they are standing on is what they trade in.
 *
 * Only a step up. Somebody who already owns the product, or a dearer one on
 * the same shelf, is not upgrading, and a basket trades a rung in once: on one
 * line, on one unit (`lineCredit`). Otherwise a cheaper purchase came off every
 * unit of every later order.
 */

export interface UpgradeCandidate {
    id: string;
    categoryId: string | null;
    /** What it costs now: the sale price where there is one. */
    price: number;
}

/**
 * What a buyer's existing purchases take off `product`, in site currency.
 *
 * Zero when they own nothing cheaper on that shelf, which is the usual answer
 * and not a special case.
 *
 * Strictly less than the price, and by construction rather than by a clamp:
 * only a rung that costs less qualifies, so the credit cannot reach it. A
 * `Math.min` guarding that was written here first and never fired - the test
 * that tried to make it fire could not construct the case.
 */
export function upgradeCredit(
    product: UpgradeCandidate,
    catalogue: readonly UpgradeCandidate[],
    ownedIds: ReadonlySet<string>,
): number {
    if (!product.categoryId) return 0;

    if (ownedIds.has(product.id)) return 0;

    let best = 0;
    for (const other of catalogue) {
        if (other.id === product.id) continue;
        if (other.categoryId !== product.categoryId) continue;
        if (!ownedIds.has(other.id)) continue;
        if (other.price >= product.price) return 0;
        if (other.price > best) best = other.price;
    }
    return best;
}

/**
 * The credit one basket line takes, given the shelves already credited.
 *
 * A line of one unit only, and the first such line on its shelf: the rung
 * owned was paid for once, so it is traded in once. `credited` is filled as
 * lines take a credit, which is why the cart and the till walk the basket in
 * one pass.
 */
export function lineCredit(
    product: UpgradeCandidate,
    quantity: number,
    catalogue: readonly UpgradeCandidate[],
    ownedIds: ReadonlySet<string>,
    credited: Set<string>,
): number {
    if (quantity !== 1 || !product.categoryId || credited.has(product.categoryId)) return 0;
    const credit = upgradeCredit(product, catalogue, ownedIds);
    if (credit > 0) credited.add(product.categoryId);
    return credit;
}

/**
 * What is left to pay after the credit. Never below zero.
 *
 * A whole number of cents, because both sides of the subtraction are money and
 * binary floating point is not: 19.99 less 9.99 is 9.999999999999998, which
 * the cart returned as its subtotal and a coupon's minimum purchase was then
 * compared against. A basket worth exactly ten was refused a coupon that asked
 * for ten.
 */
export function priceAfterCredit(price: number, credit: number): number {
    return Math.max(0, Math.round((price - credit) * 100) / 100);
}
