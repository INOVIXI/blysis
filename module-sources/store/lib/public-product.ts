/**
 * What a shopper's browser is given about a product.
 *
 * Named rather than taken from the schema, because the answer is public and a
 * shared cache holds it: without this, a column added to `Product` tomorrow is
 * published to a CDN the day it is added. `deliveryData` is the reason it
 * matters today - an operator-authored blob nothing in the product reads back,
 * so whatever an operator writes there was being served to anyone who asked.
 *
 * `isActive` is here although a public read only ever returns `true`: the page
 * declares it, and dropping a field the client names is a separate change.
 *
 * It lives here rather than in either route because the listing and the page
 * have to publish the same shape - a product that gains a field by being
 * opened is a bug report waiting to be written.
 */
export const PUBLIC_PRODUCT = {
    id: true,
    number: true,
    name: true,
    slug: true,
    description: true,
    /** The one line about it a card has room for. */
    shortDesc: true,
    price: true,
    comparePrice: true,
    image: true,
    images: true,
    stock: true,
    isActive: true,
    // When it is for sale, and what it costs while it is. The page draws a
    // countdown from these; the endpoint that takes the money re-reads them.
    availableFrom: true,
    availableUntil: true,
    availableDays: true,
    availableFromMinute: true,
    availableUntilMinute: true,
    outsideWindow: true,
    roleIds: true,
    perPersonLimit: true,
    perPersonPeriod: true,
    periodStock: true,
    periodStockWindow: true,
    salePrice: true,
    saleFrom: true,
    saleUntil: true,
    isFeatured: true,
    createdAt: true,
    category: { select: { id: true, name: true, slug: true } },
} as const;
