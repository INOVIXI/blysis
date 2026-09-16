/**
 * What a paid order grants, when the product is not owned outright.
 *
 * Settlement wrote one ownership row per product and nothing else. That is the
 * whole of "you bought it" for a shop that sells things once, and no shape at
 * all for a shop that sells access: a rank for thirty days, a membership that
 * renews, a tier that lapses. The only way to sell one was a Stripe
 * subscription, which makes the offer depend on the processor.
 *
 * Two columns changed that - a duration on the product and an end date on the
 * ownership - and this is what holds settlement to them:
 *
 * - a product with no duration is written exactly as it was, in one statement
 *   for the whole order, because that is still the common case and it must not
 *   become one query per line;
 * - a product with a duration is read first and written with an end date, so
 *   a second purchase extends what is left rather than replacing it;
 * - a product that names a role grants it, which is a different column from
 *   `roleIds` - that one says who may buy, this one says what buying gives.
 *
 * The transaction check matters as much as the values: a grant written outside
 * it is a grant that survives a rolled-back payment.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PaymentSettlement } from "@/modules/store/lib/payments";

interface Call {
    op: string;
    args: Record<string, unknown>;
    viaTx: boolean;
}
const calls: Call[] = [];

const db = {
    order: {
        findUnique: vi.fn(),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
    },
    chestItem: { create: vi.fn(async () => ({})), createMany: vi.fn(async () => ({ count: 1 })) },
    ownedProduct: {
        findMany: vi.fn(async () => [] as { productId: string; expiresAt: Date | null }[]),
        upsert: vi.fn(async () => ({})),
        createMany: vi.fn(async () => ({ count: 1 })),
        deleteMany: vi.fn(async () => ({})),
    },
    payment: {
        create: vi.fn(async () => ({})),
        findFirst: vi.fn(),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
    },
    productCommand: { findMany: vi.fn(async () => []) },
    product: {
        findMany: vi.fn(async () => [] as Record<string, unknown>[]),
        updateMany: vi.fn(async () => ({ count: 1 })),
    },
    user: {
        findUnique: vi.fn(async () => ({ roleId: "role-member" }) as { roleId: string | null } | null),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
    },
    creditTransaction: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    subscription: {
        findFirst: vi.fn(),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
    },
    timedRoleGrant: { upsert: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({})) },
    role: { findMany: vi.fn(async () => [] as { id: string; priority: number }[]) },
};

/** Records every call and whether it went through the transaction client. */
function trace<T extends object>(client: T, viaTx: boolean): T {
    return new Proxy(client, {
        get(model, modelName: string) {
            const delegate = (model as Record<string, unknown>)[modelName];
            if (typeof delegate !== "object" || delegate === null) return delegate;
            return new Proxy(delegate as object, {
                get(_, op: string) {
                    const fn = (delegate as Record<string, unknown>)[op];
                    if (typeof fn !== "function") return fn;
                    return (args: Record<string, unknown>) => {
                        calls.push({ op: `${modelName}.${op}`, args, viaTx });
                        return (fn as (a: unknown) => unknown)(args);
                    };
                },
            });
        },
    }) as T;
}

const prisma = {
    ...trace(db, false),
    $transaction: async (run: (tx: typeof db) => unknown) => run(trace(db, true)),
};

const grantRole = vi.fn(async () => {});

vi.mock("@/core/sdk/server", () => ({
    prisma,
    grantRole: (...args: unknown[]) => grantRole(...(args as [])),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    logActivity: vi.fn(async () => {}),
}));
vi.mock("@/modules/store/lib/email", () => ({ sendOrderConfirmationEmail: vi.fn(async () => {}) }));
vi.mock("@/modules/store/lib/delivery", () => ({ deliverProduct: vi.fn(async () => {}) }));
vi.mock("@/modules/store/lib/order-events", () => ({ announceOrderCompleted: vi.fn(async () => {}) }));

const { settleOrder } = await import("@/modules/store/lib/fulfilment");

const settlement: PaymentSettlement = {
    kind: "order",
    reference: "order-1",
    provider: "manual",
    providerRef: "ref-1",
    amount: 42,
    currency: "USD",
};

/** A paid order for one line of one product. */
function orderFor(productId: string) {
    return {
        id: "order-1",
        status: "PENDING",
        orderNumber: "ORD-1",
        userId: "user-1",
        total: 42,
        currency: "USD",
        metadata: {},
        user: { email: "buyer@example.com", username: "Steve" },
        items: [{ id: "i1", productId, name: "VIP", quantity: 1, price: 42, metadata: {} }],
    };
}

/** A product row as the settle path reads it. */
function product(over: Record<string, unknown>) {
    return { id: "prod-1", stock: null, durationDays: null, grantsRoleId: null, ...over };
}

beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    db.order.findUnique.mockResolvedValue(orderFor("prod-1"));
    db.order.updateMany.mockResolvedValue({ count: 1 });
    db.chestItem.createMany.mockResolvedValue({ count: 1 });
    db.ownedProduct.createMany.mockResolvedValue({ count: 1 });
    db.ownedProduct.findMany.mockResolvedValue([]);
    db.productCommand.findMany.mockResolvedValue([]);
    db.product.findMany.mockResolvedValue([product({})]);
    db.user.findUnique.mockResolvedValue({ roleId: "role-member" });
});

describe("a product owned outright", () => {
    it("is still written in one statement for the whole order", async () => {
        await settleOrder(settlement);
        expect(db.ownedProduct.createMany).toHaveBeenCalledTimes(1);
        expect(db.ownedProduct.upsert).not.toHaveBeenCalled();
    });

    it("is written with no end date", async () => {
        await settleOrder(settlement);
        const written = db.ownedProduct.createMany.mock.calls[0][0] as {
            data: { expiresAt?: Date | null }[];
        };
        expect(written.data[0].expiresAt ?? null).toBeNull();
    });
});

describe("a product sold for a while", () => {
    beforeEach(() => {
        db.product.findMany.mockResolvedValue([product({ durationDays: 30 })]);
    });

    it("is written with an end date thirty days out", async () => {
        const before = Date.now();
        await settleOrder(settlement);

        expect(db.ownedProduct.upsert).toHaveBeenCalledTimes(1);
        const call = db.ownedProduct.upsert.mock.calls[0][0] as {
            create: { expiresAt: Date };
            update: { expiresAt: Date };
        };
        const thirtyDays = 30 * 86_400_000;
        expect(call.create.expiresAt.getTime()).toBeGreaterThanOrEqual(before + thirtyDays);
        expect(call.update.expiresAt.getTime()).toBe(call.create.expiresAt.getTime());
    });

    it("extends what is left rather than replacing it", async () => {
        const twentyDaysLeft = new Date(Date.now() + 20 * 86_400_000);
        db.ownedProduct.findMany.mockResolvedValue([
            { productId: "prod-1", expiresAt: twentyDaysLeft },
        ]);

        await settleOrder(settlement);

        const call = db.ownedProduct.upsert.mock.calls[0][0] as { update: { expiresAt: Date } };
        expect(call.update.expiresAt.getTime()).toBe(twentyDaysLeft.getTime() + 30 * 86_400_000);
    });

    it("grants it inside the transaction, not beside it", async () => {
        await settleOrder(settlement);
        const grant = calls.find((c) => c.op === "ownedProduct.upsert");
        expect(grant?.viaTx).toBe(true);
    });
});

describe("a product that names a role", () => {
    it("gives the buyer that role, on top of what they already hold", async () => {
        db.product.findMany.mockResolvedValue([product({ grantsRoleId: "role-vip" })]);
        await settleOrder(settlement);

        expect(grantRole).toHaveBeenCalledWith(
            "user-1",
            "role-vip",
            expect.objectContaining({ expiresAt: null }),
        );
        // What it must not do: write the buyer's single role column. That is
        // the shape this replaces, and under it a moderator who bought a rank
        // stopped being a moderator until it lapsed.
        expect(db.user.updateMany).not.toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ roleId: expect.anything() }) }),
        );
    });

    it("gives nothing when the product names none", async () => {
        await settleOrder(settlement);
        expect(grantRole).not.toHaveBeenCalled();
    });
});

describe("a role given only for a while", () => {
    it("is granted with the day it runs out, and a label saying what bought it", async () => {
        db.product.findMany.mockResolvedValue([
            product({ grantsRoleId: "role-vip", durationDays: 30 }),
        ]);
        const before = Date.now();

        await settleOrder(settlement);

        expect(grantRole).toHaveBeenCalledTimes(1);
        const [userId, roleId, options] = grantRole.mock.calls[0] as unknown as [
            string,
            string,
            { expiresAt: Date | null; source: string },
        ];
        expect(userId).toBe("user-1");
        expect(roleId).toBe("role-vip");
        expect(options.expiresAt?.getTime()).toBeGreaterThanOrEqual(before + 30 * 86_400_000);
        // A label, not a relation: the core sweeps these and must not learn
        // what kinds of thing grant a role.
        expect(options.source).toBeTruthy();
    });

    it("grants no end date when the role is given outright", async () => {
        db.product.findMany.mockResolvedValue([product({ grantsRoleId: "role-vip" })]);
        await settleOrder(settlement);
        const [, , options] = grantRole.mock.calls[0] as unknown as [string, string, { expiresAt: Date | null }];
        expect(options.expiresAt).toBeNull();
    });

    it("grants nothing when the timed product names no role", async () => {
        db.product.findMany.mockResolvedValue([product({ durationDays: 30 })]);
        await settleOrder(settlement);
        expect(grantRole).not.toHaveBeenCalled();
    });

    it("grants after the money has moved, not inside the transaction that moved it", async () => {
        // The grant's last act is to bring the displayed role up to date,
        // which is a write against a row this transaction does not hold. And
        // an account deleted between paying and the webhook landing must not
        // roll back an order somebody has already paid for.
        db.product.findMany.mockResolvedValue([
            product({ grantsRoleId: "role-vip", durationDays: 30 }),
        ]);
        await settleOrder(settlement);

        expect(grantRole).toHaveBeenCalled();
        expect(calls.some((c) => c.op.startsWith("timedRoleGrant"))).toBe(false);
    });
});
