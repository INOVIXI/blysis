// @vitest-environment node
/**
 * A paid order can leave its buyer a coupon for the next one, and only one.
 *
 * The coupon is minted inside the settlement that marks the order paid. A
 * gateway retries its webhook and a buyer reloads the return page, so the
 * same payment arrives more than once; the second arrival must find the order
 * already thanked rather than hand out a second discount. The coupon table
 * below enforces the same unique key the database does, so a second mint
 * would show up as a second row rather than pass silently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PaymentSettlement } from "@/modules/store/lib/payments";

interface CouponRow {
    code: string;
    type: string;
    value: number;
    usageLimit: number | null;
    usageCount: number;
    expiresAt: Date | null;
    userId: string | null;
    issuedForOrderId: string | null;
    isActive: boolean;
}
const coupons: CouponRow[] = [];

/** createMany with skipDuplicates is ON CONFLICT DO NOTHING on either unique key. */
const coupon = {
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: Omit<CouponRow, "usageCount">[]; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const row of data) {
            const clash = coupons.some(
                (held) => held.code === row.code || (row.issuedForOrderId !== null && held.issuedForOrderId === row.issuedForOrderId),
            );
            if (clash) {
                if (skipDuplicates) continue;
                throw new Error("Unique constraint failed");
            }
            coupons.push({ ...row, usageCount: 0 });
            count++;
        }
        return { count };
    }),
    findUnique: vi.fn(async ({ where }: { where: { issuedForOrderId: string } }) =>
        coupons.find((row) => row.issuedForOrderId === where.issuedForOrderId) ?? null,
    ),
    updateMany: vi.fn(async ({ where, data }: { where: { issuedForOrderId: string; usageCount: number }; data: { isActive: boolean } }) => {
        let count = 0;
        for (const row of coupons) {
            if (row.issuedForOrderId === where.issuedForOrderId && row.usageCount === where.usageCount) {
                row.isActive = data.isActive;
                count++;
            }
        }
        return { count };
    }),
};

const db = {
    order: { findUnique: vi.fn(), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn() },
    chestItem: { createMany: vi.fn(async () => ({ count: 1 })) },
    ownedProduct: { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})), createMany: vi.fn(async () => ({ count: 1 })) },
    payment: { create: vi.fn(async () => ({})) },
    productCommand: { findMany: vi.fn(async () => []) },
    product: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
    role: { findMany: vi.fn(async () => []) },
    coupon,
};

const settings = { current: {} as Record<string, unknown> };
const sendOrderConfirmationEmail = vi.fn(async () => {});

vi.mock("@/core/sdk/server", () => ({
    prisma: { ...db, $transaction: async (run: (tx: typeof db) => unknown) => run(db) },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    moduleSettings: vi.fn(async () => settings.current),
}));
vi.mock("@/core/sdk", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    applyFiltersAsync: vi.fn(async () => ({ applied: true })),
    generateOrderNumber: () => "ORD-9",
}));
vi.mock("@/modules/store/lib/order-email", () => ({ sendOrderConfirmationEmail }));
vi.mock("@/modules/store/lib/delivery", () => ({ deliverProduct: vi.fn(async () => ({ success: true })) }));
vi.mock("@/modules/store/lib/order-events", () => ({ announceOrderCompleted: vi.fn(async () => {}) }));

const { settleOrder } = await import("@/modules/store/lib/fulfilment");
const { createCreditOrder } = await import("@/modules/store/lib/credit-order");
const { issueThankYouCoupon, thankYouTerms, withdrawThankYouCoupon } = await import("@/modules/store/lib/thank-you-coupon");

const ON = { thankYouCouponEnabled: true, thankYouCouponPercent: 15, thankYouCouponDays: 30, thankYouCouponMinTotal: 0 };

const settlement: PaymentSettlement = {
    kind: "order",
    reference: "order-1",
    provider: "stripe",
    providerRef: "pi_1",
    amount: 42,
    currency: "USD",
};

const pending = {
    id: "order-1",
    status: "PENDING",
    orderNumber: "ORD-1",
    userId: "buyer",
    total: 42,
    currency: "USD",
    metadata: {},
    user: { email: "buyer@example.com", username: "steve", locale: "en" },
    items: [{ id: "i1", productId: "prod-1", name: "VIP", quantity: 1, price: 42, metadata: {} }],
};

beforeEach(() => {
    vi.clearAllMocks();
    coupons.length = 0;
    settings.current = { ...ON };
    db.order.updateMany.mockResolvedValue({ count: 1 });
});

describe("what an order earns", () => {
    it("earns nothing while the shop has not switched it on", () => {
        expect(thankYouTerms({ ...ON, thankYouCouponEnabled: false }, 42)).toBeNull();
    });

    it("earns nothing below the minimum and the coupon at it", () => {
        expect(thankYouTerms({ ...ON, thankYouCouponMinTotal: 50 }, 49.99)).toBeNull();
        expect(thankYouTerms({ ...ON, thankYouCouponMinTotal: 50 }, 50)).toEqual({ percent: 15, days: 30 });
    });

    it("earns nothing for an order that cost nothing, whatever the minimum", () => {
        expect(thankYouTerms(ON, 0)).toBeNull();
    });

    it("earns nothing from a percentage nobody could mean", () => {
        expect(thankYouTerms({ ...ON, thankYouCouponPercent: 0 }, 42)).toBeNull();
        expect(thankYouTerms({ ...ON, thankYouCouponPercent: 100 }, 42)).toBeNull();
    });
});

describe("a coupon minted for an order", () => {
    it("is a single-use percentage for the buyer alone, ending the days set", async () => {
        const now = new Date("2026-01-01T00:00:00Z");
        const issued = await issueThankYouCoupon(
            db as never,
            { id: "order-1", orderNumber: "ORD-1", userId: "buyer", total: 42 },
            ON,
            now,
        );

        expect(coupons).toHaveLength(1);
        expect(coupons[0]).toMatchObject({
            type: "PERCENTAGE",
            value: 15,
            usageLimit: 1,
            userId: "buyer",
            issuedForOrderId: "order-1",
            expiresAt: new Date("2026-01-31T00:00:00Z"),
        });
        expect(issued).toEqual({ code: coupons[0].code, percent: 15, expiresAt: coupons[0].expiresAt });
        expect(issued?.code).toMatch(/^THANKS-[A-HJ-NP-Z2-9]{10}$/);
    });

    it("is minted once however often the order is thanked, and answers with the first code", async () => {
        const order = { id: "order-1", orderNumber: "ORD-1", userId: "buyer", total: 42 };
        const first = await issueThankYouCoupon(db as never, order, ON);
        const second = await issueThankYouCoupon(db as never, order, ON);

        expect(coupons).toHaveLength(1);
        expect(second?.code).toBe(first?.code);
    });

    it("stops working when the order is refunded, unless it was already spent", async () => {
        await issueThankYouCoupon(db as never, { id: "order-1", orderNumber: "ORD-1", userId: "buyer", total: 42 }, ON);
        await issueThankYouCoupon(db as never, { id: "order-2", orderNumber: "ORD-2", userId: "buyer", total: 42 }, ON);
        coupons[1].usageCount = 1;

        await withdrawThankYouCoupon(db as never, "order-1");
        await withdrawThankYouCoupon(db as never, "order-2");

        expect(coupons.map((row) => row.isActive)).toEqual([false, true]);
    });
});

describe("a settled order", () => {
    it("mints its coupon inside the claim and puts it in the confirmation email", async () => {
        db.order.findUnique.mockResolvedValueOnce(pending);

        await settleOrder(settlement);

        expect(coupons).toHaveLength(1);
        expect(sendOrderConfirmationEmail).toHaveBeenCalledWith(
            expect.objectContaining({ coupon: expect.objectContaining({ code: coupons[0].code, percent: 15 }) }),
        );
    });

    it("mints nothing more when the same payment arrives again", async () => {
        db.order.findUnique.mockResolvedValueOnce(pending);
        await settleOrder(settlement);

        // The retry read the order before the first settlement committed, so
        // it still says PENDING; the claim is what turns it away.
        db.order.findUnique.mockResolvedValueOnce(pending);
        db.order.updateMany.mockResolvedValueOnce({ count: 0 });
        await settleOrder(settlement);

        expect(coupons).toHaveLength(1);
        expect(coupon.createMany).toHaveBeenCalledTimes(1);
    });

    it("mints nothing and mails no coupon while the shop has it switched off", async () => {
        settings.current = {};
        db.order.findUnique.mockResolvedValueOnce(pending);

        await settleOrder(settlement);

        expect(coupons).toHaveLength(0);
        expect(sendOrderConfirmationEmail).toHaveBeenCalledWith(expect.objectContaining({ coupon: null }));
    });

    it("mints nothing for an order below the minimum", async () => {
        settings.current = { ...ON, thankYouCouponMinTotal: 100 };
        db.order.findUnique.mockResolvedValueOnce(pending);

        await settleOrder(settlement);

        expect(coupons).toHaveLength(0);
    });
});

describe("an order paid in credits", () => {
    it("thanks the member who paid, once, on the purchase's own transaction", async () => {
        db.order.create.mockResolvedValueOnce({ id: "order-c", orderNumber: "ORD-9", items: [] });

        await createCreditOrder(db as never, {
            buyerId: "buyer",
            ownerId: "buyer",
            gift: false,
            lines: [{ productId: "prod-1", name: "VIP", price: 42, quantity: 1, metadata: {} }],
            subtotal: 42,
            discount: 0,
            tax: 0,
            total: 42,
            currency: "usd",
            billingDetails: {},
            metadata: {},
            playerName: "steve",
            description: "Store purchase (VIP)",
        });

        expect(coupons).toEqual([expect.objectContaining({ userId: "buyer", issuedForOrderId: "order-c" })]);
    });
});
