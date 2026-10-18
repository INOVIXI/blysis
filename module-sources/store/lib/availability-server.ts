import { siteTimeZone } from "@/core/sdk/server";
import { stillOwnedWhere } from "./ownership";
import {
    availabilityOf,
    effectivePrice,
    periodStart,
    type Availability,
    type ProductRules,
} from "./availability";

/**
 * The rules, asked of the database.
 *
 * `availability.ts` is the arithmetic and knows nothing about Prisma; this is
 * the half that counts what the arithmetic needs - what one person has
 * already bought, and what everybody has bought inside the current allowance -
 * and hands the answer to the three places that ask: the list, the product
 * page, and the checkout that actually takes the money.
 */

/** What a row looks like once Prisma has read it. */
export interface ProductRow {
    id: string;
    isActive: boolean;
    roleIds: string[];
    requiresProductIds: string[];
    requiresAny: boolean;
    stock: number | null;
    price: unknown;
    availableFrom: Date | null;
    availableUntil: Date | null;
    availableDays: number[];
    availableFromMinute: number | null;
    availableUntilMinute: number | null;
    outsideWindow: string;
    perPersonLimit: number | null;
    perPersonPeriod: string;
    periodStock: number | null;
    periodStockWindow: string;
    salePrice: unknown;
    saleFrom: Date | null;
    saleUntil: Date | null;
}

const asNumber = (value: unknown): number => Number(value ?? 0);

export function rulesOf(row: ProductRow): ProductRules {
    return {
        isActive: row.isActive,
        roleIds: row.roleIds ?? [],
        requiresProductIds: row.requiresProductIds ?? [],
        requiresAny: row.requiresAny ?? false,
        availableFrom: row.availableFrom,
        availableUntil: row.availableUntil,
        availableDays: row.availableDays ?? [],
        availableFromMinute: row.availableFromMinute,
        availableUntilMinute: row.availableUntilMinute,
        outsideWindow: row.outsideWindow,
        perPersonLimit: row.perPersonLimit,
        perPersonPeriod: row.perPersonPeriod,
        periodStock: row.periodStock,
        periodStockWindow: row.periodStockWindow,
        stock: row.stock,
        price: asNumber(row.price),
        salePrice: row.salePrice === null || row.salePrice === undefined ? null : asNumber(row.salePrice),
        saleFrom: row.saleFrom,
        saleUntil: row.saleUntil,
    };
}

/**
 * What the list can filter in SQL.
 *
 * Switched off is gone for everybody. A product outside its dates is *not*
 * dropped here: an operator who chose "show it with a countdown" asked for
 * exactly that, and filtering it out in SQL was the bug that made a run
 * starting on Friday invisible until Friday - the opposite of the point.
 * Only the ones an operator asked to hide are dropped, and only while they
 * are outside their dates.
 *
 * The weekly window cannot go here at all: Postgres would have to compare two
 * columns to know whether an hour range wraps past midnight, which Prisma's
 * filter API cannot express. `hideShut` applies that to the rows this
 * returns.
 */
export function onTheShelfWhere(now: Date) {
    return {
        isActive: true,
        OR: [
            { outsideWindow: { not: "hidden" } },
            {
                AND: [
                    { OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] },
                    { OR: [{ availableUntil: null }, { availableUntil: { gt: now } }] },
                ],
            },
        ],
    };
}

/**
 * Drop the rows an operator asked to hide while they are shut.
 *
 * Applied after the query rather than inside it, for the reason above. The
 * count beside the list is taken from the same filtered set, so a page can be
 * short by however many were hidden - which is the honest answer to "how many
 * are for sale" and the reason the number is computed here rather than by a
 * second COUNT the filter cannot reach.
 */
export function hideShut<T extends ProductRow>(rows: T[], now: Date, zone: string): T[] {
    return rows.filter((row) => {
        if (row.outsideWindow !== "hidden") return true;
        // Nobody in particular, so a product gated by a rank or by owning
        // something else is judged on its hours alone here. The list is
        // shared-cached and cannot vary by who is reading; both gates are
        // advertised rather than hidden, which is also how somebody learns
        // the rank - or the tier below - is worth buying.
        const state = availabilityOf(
            { ...rulesOf(row), roleIds: [], requiresProductIds: [] },
            { boughtByPerson: 0, soldInPeriod: 0 },
            now,
            zone,
        );
        return state.state === "open" || state.state === "limit_reached";
    });
}

interface CountReader {
    user?: {
        findUnique(args: { where: { id: string }; select: { roleId: true } }): Promise<{ roleId: string | null } | null>;
    };
    ownedProduct?: {
        findMany(args: {
            where: Record<string, unknown>;
            select: { productId: true };
        }): Promise<{ productId: string }[]>;
    };
    orderItem: {
        aggregate(args: {
            where: Record<string, unknown>;
            _sum: { quantity: true };
        }): Promise<{ _sum: { quantity: number | null } }>;
    };
}

/**
 * Units of this product already paid for, inside the periods the rules count
 * over: by one person, and by everybody.
 *
 * Paid only - a pending order is not a purchase, and counting one would let a
 * checkout somebody abandoned hold the last of an allowance until it expired.
 */
export async function countsFor(
    db: CountReader,
    productId: string,
    userId: string | null,
    rules: ProductRules,
    now: Date,
): Promise<{ boughtByPerson: number; soldInPeriod: number }> {
    const paid = { status: { in: ["COMPLETED", "PROCESSING"] } };

    const personSince = periodStart(rules.perPersonPeriod, now);
    const periodSince = periodStart(rules.periodStockWindow, now);

    // A gift is an order of the sender's that the recipient owns, so it
    // counts against the recipient: what a person bought, less what they
    // gave away, plus what they were given. Three plain sums rather than one
    // filter with a NOT, which a missing metadata column would turn into
    // "matches nothing".
    const personal = (order: Record<string, unknown>) =>
        db.orderItem
            .aggregate({
                where: { productId, order: { ...paid, ...(personSince ? { createdAt: { gte: personSince } } : {}), ...order } },
                _sum: { quantity: true },
            })
            .then((sum) => sum._sum.quantity ?? 0);
    const [person, everyone] = await Promise.all([
        rules.perPersonLimit !== null && userId
            ? Promise.all([
                personal({ userId }),
                personal({ userId, metadata: { path: ["gift"], equals: true } }),
                personal({ metadata: { path: ["recipientId"], equals: userId } }),
            ]).then(([bought, given, received]) => ({ _sum: { quantity: bought - given + received } }))
            : Promise.resolve({ _sum: { quantity: null } }),
        rules.periodStock !== null
            ? db.orderItem.aggregate({
                where: {
                    productId,
                    order: { ...paid, ...(periodSince ? { createdAt: { gte: periodSince } } : {}) },
                },
                _sum: { quantity: true },
            })
            : Promise.resolve({ _sum: { quantity: null } }),
    ]);

    return {
        boughtByPerson: person._sum.quantity ?? 0,
        soldInPeriod: everyone._sum.quantity ?? 0,
    };
}

/** The state of one product for one person, with the counting done. */
export async function availabilityFor(
    db: CountReader,
    row: ProductRow,
    userId: string | null,
    now: Date = new Date(),
    zone?: string,
): Promise<Availability & { price: number; was: number | null; onSale: boolean }> {
    const rules = rulesOf(row);
    const where = zone ?? (await siteTimeZone());
    const [counts, buyer, owned] = await Promise.all([
        countsFor(db, row.id, userId, rules, now),
        // Only asked when the product names a rank: an extra read on every
        // product page for a rule almost no product uses is a read nobody
        // needed.
        rules.roleIds.length > 0 && userId && db.user
            ? db.user.findUnique({ where: { id: userId }, select: { roleId: true } })
            : Promise.resolve(null),
        // Same reason, and the same shape: only a product that names a
        // prerequisite pays for the read that answers it.
        rules.requiresProductIds.length > 0 && userId && db.ownedProduct
            ? db.ownedProduct.findMany({
                where: {
                    ...stillOwnedWhere(userId, now),
                    productId: { in: rules.requiresProductIds },
                },
                select: { productId: true },
            })
            : Promise.resolve([]),
    ]);
    return {
        ...availabilityOf(
            rules,
            {
                ...counts,
                roleId: buyer?.roleId ?? null,
                ownedProductIds: new Set(owned.map((row) => row.productId)),
            },
            now,
            where,
        ),
        ...effectivePrice(rules, now),
    };
}
