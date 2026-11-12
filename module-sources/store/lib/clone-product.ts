/**
 * Copying a product, and what a copy is not allowed to inherit.
 *
 * An operator builds one rank carefully - the commands it runs, the fields
 * the buyer fills in, the hours it is on sale, who may buy it - and then
 * wants four more of it at four prices. Typing it out again is where the
 * fourth one loses a delivery command nobody notices until somebody pays.
 *
 * The list of columns below is written out rather than spread from the source
 * row, because the failure this file exists to prevent is a column added to
 * the product a year from now and silently carried into every copy. A spread
 * copies whatever appears; a list copies what somebody decided to copy, and a
 * new column that belongs in a copy is one line here.
 */

/**
 * A product row, as much of it as a copy is made from.
 *
 * The JSON, money and kind columns are left as type parameters. This file has
 * an opinion about which columns a copy carries, not about how the database
 * spells a decimal or which kinds of product exist, and naming Prisma's types
 * here would put the database in a file that has no business knowing about it.
 */
export interface CopyableProduct<TJson, TMoney, TType> {
    name: string;
    slug: string;
    translations: TJson | null;
    description: string | null;
    shortDesc: string | null;
    price: TMoney;
    comparePrice: TMoney | null;
    image: string | null;
    images: string[];
    stock: number | null;
    type: TType;
    deliveryData: TJson | null;
    commandsPerUnit: boolean;
    subscriptionInterval: string | null;
    subscriptionIntervalCount: number | null;
    availableFrom: Date | null;
    availableUntil: Date | null;
    availableDays: number[];
    availableFromMinute: number | null;
    availableUntilMinute: number | null;
    outsideWindow: string;
    roleIds: string[];
    perPersonLimit: number | null;
    perPersonPeriod: string;
    periodStock: number | null;
    periodStockWindow: string;
    durationDays: number | null;
    grantsRoleId: string | null;
    requiresProductIds: string[];
    requiresAny: boolean;
    salePrice: TMoney | null;
    saleFrom: Date | null;
    saleUntil: Date | null;
    categoryId: string | null;
}

/**
 * The next free `<slug>-copy` name.
 *
 * It counts past every name already taken rather than filling the first gap.
 * A slug is in links, in somebody's bookmarks and in a search engine's index,
 * so handing a freed one to a new product hands it an old product's traffic.
 */
export function freeSlug(slug: string, taken: Set<string>): string {
    const first = `${slug}-copy`;
    if (!taken.has(first)) return first;

    // Past the highest, not into the first gap: stepping up from 2 would hand
    // "vip-copy-2" back the moment somebody deletes it.
    let highest = 1;
    const suffix = new RegExp(`^${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
    for (const name of taken) {
        const found = suffix.exec(name);
        if (found) highest = Math.max(highest, Number(found[1]));
    }
    return `${first}-${highest + 1}`;
}

/**
 * What to write for a copy of `product`.
 *
 * The name and the slug are the caller's: a name is a row a visitor reads,
 * and the only place that knows which language to say "copy" in is the screen
 * the operator is looking at.
 *
 * The JSON and money columns come out with the types they went in with, so a
 * caller holding a real row can hand the answer straight to a write.
 */
export function copyOf<TJson, TMoney, TType>(
    product: CopyableProduct<TJson, TMoney, TType>,
    as: { slug: string; name: string },
) {
    return {
        name: as.name,
        slug: as.slug,
        translations: product.translations,
        description: product.description,
        shortDesc: product.shortDesc,
        price: product.price,
        comparePrice: product.comparePrice,
        image: product.image,
        // Fresh arrays: Prisma is handed these directly, and sharing one means
        // an edit to the copy reaches into the original's row.
        images: [...product.images],
        stock: product.stock,
        // A copy has sold nothing. Inheriting the count ranks it above the
        // products that really outsold it on the day it was made.
        unitsSold: 0,
        // Off, whatever the original was. A product that appears in the shop
        // the instant it is made is one nobody has renamed or priced yet, and
        // the window between the click and the edit is a sale at the wrong
        // price.
        isActive: false,
        // Two of one thing on the front page is a mistake, not a decision.
        isFeatured: false,
        type: product.type,
        deliveryData: product.deliveryData,
        commandsPerUnit: product.commandsPerUnit,
        subscriptionInterval: product.subscriptionInterval,
        subscriptionIntervalCount: product.subscriptionIntervalCount,
        // The id names a price object belonging to the original. Two products
        // pointing at one of them makes a refund on either look like a refund
        // on both.
        stripePriceId: null,
        availableFrom: product.availableFrom,
        availableUntil: product.availableUntil,
        availableDays: [...product.availableDays],
        availableFromMinute: product.availableFromMinute,
        availableUntilMinute: product.availableUntilMinute,
        outsideWindow: product.outsideWindow,
        roleIds: [...product.roleIds],
        perPersonLimit: product.perPersonLimit,
        perPersonPeriod: product.perPersonPeriod,
        periodStock: product.periodStock,
        periodStockWindow: product.periodStockWindow,
        durationDays: product.durationDays,
        grantsRoleId: product.grantsRoleId,
        requiresProductIds: [...product.requiresProductIds],
        requiresAny: product.requiresAny,
        salePrice: product.salePrice,
        saleFrom: product.saleFrom,
        saleUntil: product.saleUntil,
        categoryId: product.categoryId,
    };
}
