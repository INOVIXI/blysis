// Pure checkout pricing math, extracted verbatim from api/checkout/route.ts so
// the money calculations can be unit-tested without a DB, Stripe, or auth.
//
// These functions take plain numbers/objects (the route still does the
// Prisma Decimal -> Number() coercion at the call site) and contain NO I/O.
// Behaviour is identical to the previous inline implementation; the route
// imports computeOrderPricing/computeCouponDiscount/computeTotals instead of
// inlining the arithmetic.

/**
 * Money, to the cent.
 *
 * Every number here is a currency amount, and a currency amount that is not a
 * whole number of cents cannot be charged. A percentage discount produces one
 * immediately (33% off 9.99 is 6.6933), and nothing downstream used to round
 * it: the order was stored at 6.6933, the receipt showed 6.69, and each
 * gateway rounded on its own terms - Stripe per line, iyzico with toFixed(2),
 * PayTR on the total. So the amount charged, the amount recorded and the
 * amount shown could all differ, and the gap grew with the quantity.
 *
 * Rounding once, here, at the moment each amount is computed, makes those
 * three agree by construction: everything downstream already receives whole
 * cents, so a gateway's own rounding becomes a no-op.
 */
const cents = (amount: number): number => Math.round(amount * 100) / 100;

export interface PricingProduct {
    id: string;
    name: string;
    type?: string | null;
    price: number;
    categoryId?: string | null;
}

/**
 * What a rule covers. Empty means everything, which is what every rule
 * written before there was a way to say otherwise meant.
 */
export interface PricingScope {
    productIds?: readonly string[] | null;
    categoryIds?: readonly string[] | null;
}

/**
 * Whether a rule's shelf holds this line.
 *
 * One function for the coupon and for the bulk discount, because they are one
 * question and they were answered twice. The coupon had no answer at all, and
 * the bulk discount matched `productId === id || categoryId === category`,
 * which is a rule that can name one of each and then covers a product in
 * neither of them.
 */
export function scopeCoversLine(
    scope: PricingScope,
    productId: string,
    categoryId: string | null | undefined,
): boolean {
    const products = scope.productIds ?? [];
    const categories = scope.categoryIds ?? [];
    if (products.length === 0 && categories.length === 0) return true;
    if (products.includes(productId)) return true;
    return categoryId != null && categories.includes(categoryId);
}

export interface PricingItemInput {
    productId: string;
    quantity: number;
}

export interface PricingBulkDiscount {
    minQuantity: number;
    discountPercent: number;
    productIds?: readonly string[] | null;
    categoryIds?: readonly string[] | null;
    isActive?: boolean;
}

export interface ComputedOrderItem {
    productId: string;
    name: string;
    price: number;
    quantity: number;
    metadata: {
        type: string | null | undefined;
        variables: Record<string, string>;
        bulkDiscount?: number;
    };
}

/**
 * Per-item price resolution: cumulative-upgrade credit (pay only the
 * difference when the buyer already owns a cheaper product in the same
 * category) followed by the best matching bulk discount. Returns the line
 * items plus the running subtotal.
 *
 * The order `bulkDiscounts` arrives in no longer matters: the rung is chosen
 * by `bulkDiscountFor`, which takes the best one reached rather than the
 * first one that matches.
 */
export function computeOrderPricing(params: {
    items: PricingItemInput[];
    products: PricingProduct[];
    bulkDiscounts: PricingBulkDiscount[];
    ownedProductIds: Set<string>;
    variables?: Record<string, Record<string, string>>;
}): { subtotal: number; orderItems: ComputedOrderItem[] } {
    const { items, products, bulkDiscounts, ownedProductIds, variables } = params;

    let subtotal = 0;
    const orderItems = items.map((item): ComputedOrderItem => {
        const product = products.find((p) => p.id === item.productId)!;
        let price = Number(product.price);

        // Cumulative upgrade: pay difference if user owns cheaper in same category
        if (product.categoryId) {
            const ownedInCategory = products.filter(
                (p) => p.categoryId === product.categoryId && ownedProductIds.has(p.id) && Number(p.price) < price
            );
            if (ownedInCategory.length > 0) {
                const highestOwned = Math.max(...ownedInCategory.map((p) => Number(p.price)));
                price = Math.max(0, price - highestOwned);
            }
        }

        // The same rung the product page quoted, from the same function.
        const bulkDiscountApplied = bulkDiscountFor(bulkDiscounts, product, item.quantity);
        if (bulkDiscountApplied > 0) {
            price = price * (1 - bulkDiscountApplied / 100);
        }

        // Rounded before the quantity multiplies it: a third of a cent on
        // one seat is a cent on the fourth, and the gateway bills per line.
        price = cents(price);
        subtotal += price * item.quantity;

        return {
            productId: product.id,
            name: product.name,
            price,
            quantity: item.quantity,
            metadata: {
                type: product.type,
                variables: variables?.[product.id] || {},
                ...(bulkDiscountApplied > 0 ? { bulkDiscount: bulkDiscountApplied } : {}),
            },
        };
    });

    return { subtotal: cents(subtotal), orderItems };
}

/** One rung: buy this many, take this much off. */
export interface BulkRung {
    minQuantity: number;
    discountPercent: number;
}

/**
 * What a shopper can climb on one product, best offer per rung.
 *
 * Nothing drew this. The only reader of the table was the till, so the shelf,
 * the product page and the basket all quoted the list price and the discount
 * appeared for the first time on the receipt - a discount nobody is told
 * about sells nothing extra, which is the whole purpose of one.
 *
 * Two rules asking for the same quantity leave the better of the two, because
 * that is the one the till applies and a ladder that disagrees with the till
 * is worse than no ladder.
 */
export function bulkLadder(
    rules: readonly PricingBulkDiscount[],
    product: { id: string; categoryId?: string | null },
): BulkRung[] {
    const best = new Map<number, number>();
    for (const rule of rules) {
        if (rule.isActive === false) continue;
        if (!scopeCoversLine(rule, product.id, product.categoryId)) continue;
        const held = best.get(rule.minQuantity) ?? 0;
        if (rule.discountPercent > held) best.set(rule.minQuantity, rule.discountPercent);
    }
    return [...best.entries()]
        .map(([minQuantity, discountPercent]) => ({ minQuantity, discountPercent }))
        .sort((a, b) => a.minQuantity - b.minQuantity);
}

/**
 * The percentage this quantity of this product earns: the best rung reached,
 * not the first. The till and every screen ahead of it ask this one function.
 */
export function bulkDiscountFor(
    rules: readonly PricingBulkDiscount[],
    product: { id: string; categoryId?: string | null },
    quantity: number,
): number {
    return bulkLadder(rules, product)
        .filter((rung) => rung.minQuantity <= quantity)
        .reduce((best, rung) => Math.max(best, rung.discountPercent), 0);
}

// Prisma money columns arrive as Decimal objects, not primitives. Every
// numeric read in computeCouponDiscount already goes through Number(), which
// coerces a Decimal via its valueOf/toString - so we accept either here to
// keep the route's behaviour identical while satisfying the type checker.
type DecimalLike = number | { toString(): string };

export interface CouponInput {
    isActive: boolean;
    type: string; // "PERCENTAGE" | other (fixed)
    value: DecimalLike;
    maxDiscount?: DecimalLike | null;
    minPurchase?: DecimalLike | null;
    usageLimit?: number | null;
    usageCount?: number;
    startsAt?: Date | null;
    expiresAt?: Date | null;
}

/**
 * What a coupon covers. Empty means every product, which is what every coupon
 * written before there was a way to say otherwise meant.
 */
export interface CouponScope {
    productIds?: readonly string[] | null;
    categoryIds?: readonly string[] | null;
}

/**
 * Why a coupon did nothing, as a code rather than as a sentence.
 *
 * It used to answer in English prose, which meant the two screens that ask
 * threw the answer away and said "invalid coupon" for all six reasons - the
 * one a shopper can act on included. A code travels; the words are chosen
 * where the reader's language is known.
 */
export type CouponRefusal =
    | "coupon_unknown"
    | "coupon_not_started"
    | "coupon_expired"
    | "coupon_used_up"
    | "coupon_min_purchase"
    | "coupon_not_for_these_items";

export interface CouponResult {
    /** Human-readable rejection reason, or null when the coupon applies. */
    error: string | null;
    /** Why it was refused, for whoever knows the reader's language. */
    code: CouponRefusal | null;
    /** Discount amount in currency units (0 when rejected). */
    discount: number;
}

/**
 * How much of a basket a coupon covers.
 *
 * A coupon naming nothing covers all of it. A coupon naming products or
 * categories covers the lines that match either - a line matched by both is
 * still one line, which is why this counts lines rather than summing two
 * filters.
 */
export function couponEligibleSubtotal(
    scope: CouponScope,
    items: readonly { productId: string; price: number; quantity: number }[],
    products: readonly { id: string; categoryId?: string | null }[],
): number {
    const productIds = new Set(scope.productIds ?? []);
    const categoryIds = new Set(scope.categoryIds ?? []);
    if (productIds.size === 0 && categoryIds.size === 0) {
        return cents(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
    }

    const categoryOf = new Map(products.map((product) => [product.id, product.categoryId ?? null]));
    const covered = items.filter((item) => {
        if (productIds.has(item.productId)) return true;
        const category = categoryOf.get(item.productId);
        return category !== null && category !== undefined && categoryIds.has(category);
    });
    return cents(covered.reduce((sum, item) => sum + item.price * item.quantity, 0));
}

/**
 * Validate + price a coupon against the current subtotal. Mirrors the inline
 * transaction body in the route: not-found/inactive, not-yet-active, expired,
 * usage-cap, and min-purchase gates all reject with a message; PERCENTAGE
 * applies value% (capped at maxDiscount), otherwise a fixed amount capped at
 * the subtotal. `now` is injectable for deterministic tests.
 */
export function computeCouponDiscount(
    coupon: CouponInput | null | undefined,
    subtotal: number,
    now: Date = new Date(),
    /**
     * The part of the basket this coupon covers. Defaults to all of it, which
     * is what a coupon naming no product and no category covers.
     *
     * Separate from `subtotal` because the two answer different questions:
     * the minimum purchase is about the order - "spend 50" - and the discount
     * is about the shelf the offer is on. Reading either against the other is
     * a shop that overcharges or undercharges.
     */
    eligibleSubtotal: number = subtotal,
): CouponResult {
    const no = (code: CouponRefusal, error: string): CouponResult => ({ error, code, discount: 0 });

    if (!coupon || !coupon.isActive) return no("coupon_unknown", "Coupon code not found or inactive");

    if (coupon.startsAt && coupon.startsAt > now) return no("coupon_not_started", "Coupon is not yet active");
    if (coupon.expiresAt && coupon.expiresAt < now) return no("coupon_expired", "Coupon has expired");
    if (coupon.usageLimit && (coupon.usageCount ?? 0) >= coupon.usageLimit) {
        return no("coupon_used_up", "Coupon usage limit reached");
    }
    if (coupon.minPurchase && subtotal < Number(coupon.minPurchase)) {
        return no("coupon_min_purchase", `Coupon requires a minimum purchase of ${Number(coupon.minPurchase)}`);
    }
    if (eligibleSubtotal <= 0) {
        return no("coupon_not_for_these_items", "Coupon does not apply to anything in this basket");
    }

    let discount: number;
    if (coupon.type === "PERCENTAGE") {
        discount = eligibleSubtotal * (Number(coupon.value) / 100);
        if (coupon.maxDiscount) discount = Math.min(discount, Number(coupon.maxDiscount));
    } else {
        discount = Math.min(Number(coupon.value), eligibleSubtotal);
    }
    return { error: null, code: null, discount: cents(discount) };
}

/**
 * Creator-code discount: a percentage of the subtotal AFTER the coupon has
 * been applied. Returns 0 for a missing/zero percent.
 */
export function computeCreatorDiscount(
    subtotal: number,
    couponDiscount: number,
    discountPercent: number
): number {
    const afterCoupon = subtotal - couponDiscount;
    return cents(afterCoupon * (discountPercent / 100));
}

/**
 * A creator's cut of an order.
 *
 * Paid into a credit balance and written to the ledger, so it is money in the
 * same sense the order total is: a commission of 7.5% on 17.51 is 1.313825,
 * and a balance cannot hold that.
 */
export function computeCreatorCommission(total: number, commissionPercent: number): number {
    return cents(total * (commissionPercent / 100));
}

/**
 * Final tax + total roll-up, clamped so a discount that exceeds the subtotal
 * can never produce a negative charge. `taxRate` is a percentage (e.g. 8 for
 * 8%); the rounding (round to cents) matches the route's Math.round(.. )/100.
 */
export function computeTotals(params: {
    subtotal: number;
    couponDiscount: number;
    creatorDiscount: number;
    taxRate: number;
    /**
     * Whether the prices already contain the tax.
     *
     * Adding tax on top is how a shop quotes a price in one part of the world
     * and wrong in most of the rest: where a consumer price is quoted
     * tax-inclusive by law, adding it at checkout charges more than the page
     * said and puts the wrong figure on the invoice.
     */
    taxIncluded?: boolean;
}): { totalDiscount: number; taxableAmount: number; tax: number; total: number } {
    const { subtotal, couponDiscount, creatorDiscount, taxRate, taxIncluded = false } = params;
    const totalDiscount = cents(couponDiscount + creatorDiscount);
    const discounted = cents(Math.max(0, subtotal - totalDiscount));

    if (taxRate <= 0) {
        return { totalDiscount, taxableAmount: discounted, tax: 0, total: discounted };
    }

    if (taxIncluded) {
        // The tax inside a gross figure is not a percentage of it. At 20 per
        // cent the tax inside 120 is 20, not 24, and the difference is what an
        // invoice is checked against.
        //
        // The net is derived and the tax is the remainder, rather than both
        // being rounded from the gross: rounding twice is how a line item
        // comes out a penny short of what the customer was charged.
        const net = cents(discounted / (1 + taxRate / 100));
        return { totalDiscount, taxableAmount: net, tax: cents(discounted - net), total: discounted };
    }

    const tax = cents((discounted * taxRate) / 100);
    return { totalDiscount, taxableAmount: discounted, tax, total: cents(discounted + tax) };
}

/** A processor's cut, as an operator enters it. */
export interface ProcessorFee {
    /** Percentage of the charge. */
    percent: number;
    /** Flat amount per transaction, in the order's currency. */
    fixed: number;
}

/**
 * What to charge so the shop is left with what it asked for.
 *
 * The obvious way to pass a fee on is to add the percentage to the total, and
 * it is wrong: the processor takes its cut of the larger amount too. A shop
 * adding 2.9 per cent to a 100 charge is paid 102.90 and keeps 99.92 - short
 * by almost exactly the fee it was trying not to pay.
 *
 * So it divides rather than multiplies, and the fixed part goes inside the
 * division because the processor takes its percentage of the whole charge,
 * including the part covering its own flat fee.
 *
 * A percentage that would eat the entire payment is a number somebody typed,
 * not a fee. 100 divides by zero and anything above it goes negative, so the
 * charge is left alone rather than turned into infinity.
 */
export function grossUpForFee(net: number, fee: ProcessorFee): { charged: number; surcharge: number } {
    const percent = Number.isFinite(fee.percent) ? fee.percent : 0;
    const fixed = Number.isFinite(fee.fixed) ? fee.fixed : 0;
    if (net <= 0 || percent < 0 || percent >= 100 || (percent === 0 && fixed <= 0)) {
        return { charged: cents(Math.max(0, net)), surcharge: 0 };
    }
    const charged = cents((net + Math.max(0, fixed)) / (1 - percent / 100));
    return { charged, surcharge: cents(charged - net) };
}
