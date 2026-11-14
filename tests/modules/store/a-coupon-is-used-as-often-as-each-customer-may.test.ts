// @vitest-environment node
/**
 * A coupon counts each customer, not only everybody together.
 *
 * A coupon had one cap across every buyer, so one player could use a code
 * meant for the whole community again and again until the cap ran out. A
 * coupon now says how many orders one customer may place with it, counted
 * from the orders that carry it: a refunded or cancelled order gives its use
 * back, an unpaid checkout holds one for an hour, and the count that decides
 * is taken again under a lock when the order is paid.
 */
import { describe, it, expect, vi } from "vitest";
import { computeCouponDiscount } from "@/modules/store/lib/pricing";
import { customerUses, pastCouponLimit } from "@/modules/store/lib/coupon-limit";
import { foldUses, pairKey } from "@/modules/store/lib/coupon-uses";

interface OrderRow {
    id: string;
    couponId: string | null;
    userId: string | null;
    status: string;
    createdAt: Date;
}

const NOW = new Date("2026-06-01T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

/** Reads the `where` the counter builds the way Postgres would, over rows held in memory. */
function matches(row: OrderRow, where: Record<string, unknown>): boolean {
    for (const [key, test] of Object.entries(where)) {
        if (key === "OR") {
            if (!(test as Record<string, unknown>[]).some((branch) => matches(row, branch))) return false;
            continue;
        }
        const value = row[key as keyof OrderRow];
        if (test !== null && typeof test === "object" && !(test instanceof Date)) {
            const op = test as { in?: unknown[]; not?: unknown; gte?: Date };
            if (op.in && !op.in.includes(value)) return false;
            if ("not" in op && value === op.not) return false;
            if (op.gte && !(value instanceof Date && value >= op.gte)) return false;
        } else if (value !== test) {
            return false;
        }
    }
    return true;
}

function shop(orders: OrderRow[], perCustomerLimit: number | null) {
    return {
        order: { count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => orders.filter((row) => matches(row, where)).length) },
        coupon: { findUnique: vi.fn(async () => ({ perCustomerLimit })) },
        $executeRaw: vi.fn(async () => 1),
    };
}

const order = (id: string, status: string, createdAt: Date = minutesAgo(600), userId = "u1"): OrderRow => ({
    id,
    couponId: "c1",
    userId,
    status,
    createdAt,
});

const coupon = { isActive: true, type: "PERCENTAGE", value: 10, perCustomerLimit: 1 as number | null };

describe("the price a coupon gives one customer", () => {
    it("refuses a customer who has used it as often as it allows", () => {
        expect(computeCouponDiscount(coupon, 100, NOW, 100, 1)).toMatchObject({ code: "coupon_already_used", discount: 0 });
    });

    it("prices it for a customer with a use left", () => {
        expect(computeCouponDiscount({ ...coupon, perCustomerLimit: 2 }, 100, NOW, 100, 1)).toMatchObject({ code: null, discount: 10 });
    });

    it("has no per-customer limit on a coupon that names none", () => {
        expect(computeCouponDiscount({ ...coupon, perCustomerLimit: null }, 100, NOW, 100, 50)).toMatchObject({ code: null });
    });

    it("says the whole code is used up before it says this customer used it", () => {
        const spent = { ...coupon, usageLimit: 5, usageCount: 5 };
        expect(computeCouponDiscount(spent, 100, NOW, 100, 1).code).toBe("coupon_used_up");
    });
});

describe("a customer's uses of a coupon", () => {
    it("counts paid orders and gives back refunded and cancelled ones", async () => {
        const db = shop([
            order("o1", "COMPLETED"),
            order("o2", "PROCESSING"),
            order("o3", "REFUNDED"),
            order("o4", "CANCELLED"),
            order("o5", "COMPLETED", minutesAgo(5), "u2"),
        ], 1);

        await expect(customerUses(db, "c1", "u1", NOW)).resolves.toBe(2);
    });

    it("holds a checkout still waiting for its payment for an hour, at checkout", async () => {
        const db = shop([order("o1", "PENDING", minutesAgo(10)), order("o2", "PENDING", minutesAgo(90))], 1);

        await expect(customerUses(db, "c1", "u1", NOW)).resolves.toBe(1);
        await expect(customerUses(db, "c1", "u1", NOW, { paidOnly: true })).resolves.toBe(0);
    });
});

describe("the count when an order is paid", () => {
    it("refuses a second paid order for a one-use coupon, counted under a lock", async () => {
        const db = shop([order("o1", "COMPLETED"), order("o2", "PENDING", minutesAgo(1))], 1);

        await expect(pastCouponLimit(db, "c1", "u1", NOW, "o2")).resolves.toBe(true);
        expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("does not count the order being paid against itself, nor other unpaid checkouts", async () => {
        // Two checkouts opened together: neither is paid yet, so the first
        // to settle goes through and the second is refused once it is.
        const db = shop([order("o1", "PENDING", minutesAgo(1)), order("o2", "PENDING", minutesAgo(1))], 1);

        await expect(pastCouponLimit(db, "c1", "u1", NOW, "o2")).resolves.toBe(false);
    });

    it("lets a customer use it again once the order that held the use was refunded", async () => {
        const db = shop([order("o1", "REFUNDED"), order("o2", "PENDING", minutesAgo(1))], 1);

        await expect(pastCouponLimit(db, "c1", "u1", NOW, "o2")).resolves.toBe(false);
    });

    it("takes no lock for a coupon without a limit, an order without a coupon or a buyer who is gone", async () => {
        const db = shop([order("o1", "COMPLETED")], null);

        await expect(pastCouponLimit(db, "c1", "u1", NOW)).resolves.toBe(false);
        await expect(pastCouponLimit(db, null, "u1", NOW)).resolves.toBe(false);
        await expect(pastCouponLimit(db, "c1", null, NOW)).resolves.toBe(false);
        expect(db.$executeRaw).not.toHaveBeenCalled();
    });
});

describe("the operator's list of uses", () => {
    it("folds order counts into held, waiting and given back for each customer", () => {
        const uses = foldUses([
            { couponId: "c1", userId: "u1", status: "COMPLETED", _count: 2 },
            { couponId: "c1", userId: "u1", status: "PENDING", _count: 1 },
            { couponId: "c1", userId: "u1", status: "REFUNDED", _count: 1 },
            { couponId: "c1", userId: "u1", status: "CANCELLED", _count: 3 },
            { couponId: "c1", userId: null, status: "COMPLETED", _count: 1 },
        ]);

        expect(uses.get(pairKey("c1", "u1"))).toEqual({ couponId: "c1", userId: "u1", held: 2, waiting: 1, returned: 4 });
        // A deleted account is its own row, not folded into a live one.
        expect(uses.get(pairKey("c1", null))).toMatchObject({ held: 1 });
    });
});
