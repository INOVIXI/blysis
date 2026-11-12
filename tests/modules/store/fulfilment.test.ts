// @vitest-environment node
/**
 * What the store does once a gateway says the money arrived.
 *
 * This is the half of the payment contract the store owns. A gateway reports a
 * settlement; everything here - marking the order, granting the products,
 * recording the payment, refusing to do any of it twice - is the store's, and
 * it is the same code whether the money came through Stripe, PayPal or a
 * gateway nobody has written yet.
 *
 * Idempotency is the point of most of these tests. Webhooks retry by design,
 * and a buyer can reload a return URL, so every entry point has to be safe to
 * call again with the same settlement.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Every model method is one `vi.fn`, reachable through two clients: `db`, the
 * module-level one, and the transaction client the `$transaction` callback is
 * handed. They share the mock so `toHaveBeenCalledWith` reads the same either
 * way, and `calls` records which client was used - because reaching for the
 * module-level client inside a transaction callback runs outside the
 * transaction and looks identical in the source.
 */
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
    chestItem: {
        create: vi.fn(async () => ({})),
        createMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(async () => [] as unknown[]),
        updateMany: vi.fn(async () => ({ count: 0 })),
        deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    ownedProduct: {
        upsert: vi.fn(async () => ({})),
        createMany: vi.fn(async () => ({ count: 1 })),
        deleteMany: vi.fn(async () => ({})),
        findMany: vi.fn(async () => [] as unknown[]),
        update: vi.fn(async () => ({})),
        count: vi.fn(async () => 0),
    },
    payment: {
        create: vi.fn(async () => ({})),
        findFirst: vi.fn(),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
    },
    productCommand: { findMany: vi.fn(async () => []) },
    // Settlement takes stock off the shelf now. These fixtures sell products
    // the shop does not count - `stock: null` - so the read finds nothing to
    // take and no product is written to. `a-limited-product-runs-out.test.ts`
    // is where the counting itself is tested.
    product: { findMany: vi.fn(async (): Promise<unknown[]> => []), updateMany: vi.fn(async () => ({ count: 1 })) },
    orderItem: { aggregate: vi.fn(async () => ({ _sum: { quantity: null as number | null } })) },
    user: { update: vi.fn(async () => ({})), findUnique: vi.fn(async () => null as unknown) },
    creatorCode: {
        findUnique: vi.fn(async () => null as unknown),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
    },
    creditTransaction: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    creditTopUp: {
        findUnique: vi.fn(async () => null as unknown),
        findFirst: vi.fn(async () => null as unknown),
        updateMany: vi.fn(async () => ({ count: 1 })),
    },
    subscription: {
        findFirst: vi.fn(),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async () => ({})),
    },
    // The real client runs a callback's writes atomically, and builds the
    // array form's promises before it ever sees them; either way the same
    // writes happen in the same order.
    $transaction: vi.fn(async (arg: unknown) => {
        if (typeof arg === "function") return await (arg as (tx: unknown) => Promise<unknown>)(txClient);
        return await Promise.all(arg as Promise<unknown>[]);
    }),
};

/** Wraps every model method so the client it came through is recorded. */
function trace(client: Record<string, Record<string, unknown>>, viaTx: boolean) {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [model, methods] of Object.entries(client)) {
        if (typeof methods !== "object" || methods === null) continue;
        out[model] = {};
        for (const [name, fn] of Object.entries(methods)) {
            out[model][name] = async (args: Record<string, unknown>) => {
                calls.push({ op: `${model}.${name}`, args, viaTx });
                return await (fn as (a: unknown) => Promise<unknown>)(args);
            };
        }
    }
    return out;
}

const models = Object.fromEntries(Object.entries(db).filter(([k]) => k !== "$transaction")) as Record<
    string,
    Record<string, unknown>
>;
const executeRaw = vi.fn(async () => 1);
const txClient = { ...trace(models, true), $executeRaw: executeRaw };
const prismaClient = { ...trace(models, false), $transaction: db.$transaction };

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
const rolesHeldBy = vi.fn(async (): Promise<{ roleId: string; source: string }[]> => []);
const revokeRole = vi.fn(async () => {});
vi.mock("@/core/sdk/server", () => ({
    prisma: prismaClient,
    log,
    rolesHeldBy,
    revokeRole,
}));

/**
 * The wallet belongs to the credits module now, so what the shop does here is
 * ask. The request is what these tests can see, and what the wallet does with
 * it is tested where it is written.
 */
const applyFiltersAsync = vi.fn(async (_hook: string, value: unknown) => value);
vi.mock("@/core/sdk", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    applyFiltersAsync,
}));

const sendOrderConfirmationEmail = vi.fn(async () => {});
vi.mock("@/modules/store/lib/order-email", () => ({ sendOrderConfirmationEmail }));
const deliverProduct = vi.fn(async () => ({}));
vi.mock("@/modules/store/lib/delivery", () => ({ deliverProduct }));
const announceOrderCompleted = vi.fn(async () => {});
const announceOrderRefunded = vi.fn(async () => {});
vi.mock("@/modules/store/lib/order-events", () => ({ announceOrderCompleted, announceOrderRefunded }));

const { settlePayment, settleOrder, cancelPayment, voidOrder, refundPayment, applySubscriptionChange } = await import(
    "@/modules/store/lib/fulfilment"
);
const { settleCredits } = await import("@/modules/store/lib/credit-top-up");

const settlement: PaymentSettlement = {
    kind: "order",
    reference: "order-1",
    provider: "stripe",
    providerRef: "pi_123",
    amount: 42,
    currency: "USD",
    metadata: { playerName: "Steve" },
};

const paidOrder = {
    id: "order-1",
    status: "COMPLETED",
    orderNumber: "ORD-1",
    userId: "user-1",
    total: 42,
    currency: "USD",
    metadata: { playerName: "Steve" },
    user: { email: "buyer@example.com", username: "Steve" },
    items: [{ id: "i1", productId: "prod-1", name: "VIP", quantity: 1, price: 42, metadata: {} }],
};

beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    applyFiltersAsync.mockImplementation(async (_hook: string, value: unknown) => value);
    db.order.update.mockResolvedValue({});
    db.order.updateMany.mockResolvedValue({ count: 1 });
    db.subscription.updateMany.mockResolvedValue({ count: 1 });
    db.chestItem.createMany.mockResolvedValue({ count: 1 });
    db.ownedProduct.createMany.mockResolvedValue({ count: 1 });
    db.productCommand.findMany.mockResolvedValue([]);
    db.creditTransaction.findUnique.mockResolvedValue(null);
    db.creditTopUp.findUnique.mockResolvedValue(null);
    db.creditTopUp.updateMany.mockResolvedValue({ count: 1 });
});

describe("settleOrder", () => {
    it("completes the order, grants what was bought and records the payment", async () => {
        db.order.findUnique.mockResolvedValueOnce({ ...paidOrder, status: "PENDING" });

        const outcome = await settleOrder(settlement);

        expect(outcome).toEqual({ handled: true, duplicate: false, error: null });
        // Claimed with a condition, not a bare update: the read above is a
        // snapshot, and a gateway retry racing a reloaded return URL would
        // otherwise pass it twice and grant the order twice.
        expect(db.order.updateMany).toHaveBeenCalledWith({
            where: { id: "order-1", status: { in: ["PENDING", "PROCESSING"] } },
            data: expect.objectContaining({
                status: "COMPLETED",
                paymentMethod: "stripe",
                paymentId: "pi_123",
            }),
        });
        expect(db.chestItem.createMany).toHaveBeenCalledTimes(1);
        expect(db.ownedProduct.createMany).toHaveBeenCalledTimes(1);
        expect(db.payment.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    orderId: "order-1",
                    provider: "stripe",
                    providerId: "pi_123",
                    amount: 42,
                    // Stored lowercase whatever case the gateway reported.
                    currency: "usd",
                    status: "COMPLETED",
                }),
            }),
        );
        expect(announceOrderCompleted).toHaveBeenCalledWith("order-1");
    });

    it("records the payment method the money actually came through", async () => {
        db.order.findUnique.mockResolvedValueOnce({ ...paidOrder, status: "PENDING" });

        await settleOrder({ ...settlement, provider: "paypal", providerRef: "PAY-9" });

        expect(db.order.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ paymentMethod: "paypal", paymentId: "PAY-9" }),
            }),
        );
    });

    it("says duplicate, and grants nothing, when the order is already completed", async () => {
        db.order.findUnique.mockResolvedValueOnce({ id: "order-1", status: "COMPLETED" });

        const outcome = await settleOrder(settlement);

        expect(outcome).toEqual({ handled: true, duplicate: true, error: null });
        expect(db.order.updateMany).not.toHaveBeenCalled();
        expect(db.chestItem.createMany).not.toHaveBeenCalled();
        expect(db.payment.create).not.toHaveBeenCalled();
        expect(announceOrderCompleted).not.toHaveBeenCalled();
    });

    // "handled" with an error, not unhandled: the store did answer, and a
    // gateway retrying a settlement for an order that does not exist would
    // retry it forever.
    it("answers an unknown order with an error rather than silence", async () => {
        db.order.findUnique.mockResolvedValueOnce(null);

        const outcome = await settleOrder(settlement);

        expect(outcome.handled).toBe(true);
        expect(outcome.error).toMatch(/unknown order/i);
        expect(db.order.updateMany).not.toHaveBeenCalled();
    });

    // Handled, so the provider does not retry a reference that will never
    // exist. But money arrived for it, and a top-up started before top-ups
    // were written down carries the buyer's id here: the operator has to
    // hear of it, because the gateway logs only what was not handled.
    it("says loudly that money arrived for a reference it does not know", async () => {
        db.order.findUnique.mockResolvedValueOnce(null);

        await settleOrder(settlement);

        expect(log.error).toHaveBeenCalledWith(
            expect.stringMatching(/nothing the store knows/),
            expect.objectContaining({ reference: "order-1", provider: "stripe", providerRef: "pi_123" }),
        );
    });

    // The order is paid either way. There is simply nobody left to grant to.
    it("keeps a paid order completed when the buyer's account is gone", async () => {
        db.order.findUnique.mockResolvedValueOnce({ ...paidOrder, status: "PENDING", userId: null, user: null });

        const outcome = await settleOrder(settlement);

        expect(outcome.handled).toBe(true);
        expect(db.payment.create).toHaveBeenCalledTimes(1);
        expect(db.chestItem.createMany).not.toHaveBeenCalled();
        expect(sendOrderConfirmationEmail).not.toHaveBeenCalled();
    });

    /**
     * The order was marked COMPLETED, then re-read, then granted a row at a
     * time, then paid - four sets of round trips after it already said it was
     * paid. A process that died in between left a buyer who had paid with a
     * COMPLETED order and an empty chest, and the duplicate guard above then
     * refused every retry that would have fixed it.
     */
    it("completes, grants and records the payment through one transaction client", async () => {
        db.order.findUnique.mockResolvedValueOnce({ ...paidOrder, status: "PENDING" });

        await settleOrder(settlement);

        expect(calls.filter((c) => c.viaTx).map((c) => c.op)).toEqual([
            "order.updateMany",
            // Which products the shop counts, asked inside the transaction so
            // the take is decided against the same snapshot as the claim, and
            // then the sale counted against the product row.
            "product.findMany",
            "product.updateMany",
            "chestItem.createMany",
            // What each product grants beyond the row: a duration and a role.
            // Its own read rather than columns added to the stock query above,
            // which asks only about products the shop counts.
            "product.findMany",
            "ownedProduct.createMany",
            "payment.create",
        ]);
        // Anything that completes or grants through the module-level client
        // runs outside the transaction, however it is spelled.
        const outside = calls.filter((c) => !c.viaTx).map((c) => c.op);
        for (const op of ["order.update", "order.updateMany", "chestItem.create", "chestItem.createMany", "ownedProduct.upsert", "ownedProduct.createMany", "payment.create"]) {
            expect(outside, `${op} must not run outside the transaction`).not.toContain(op);
        }
    });

    it("grants nothing when another delivery of the same payment won the claim", async () => {
        db.order.findUnique.mockResolvedValueOnce({ ...paidOrder, status: "PENDING" });
        db.order.updateMany.mockResolvedValueOnce({ count: 0 });

        const outcome = await settleOrder(settlement);

        expect(outcome).toEqual({ handled: true, duplicate: true, error: null });
        expect(calls.map((c) => c.op)).toEqual(["order.findUnique", "order.updateMany"]);
        expect(announceOrderCompleted).not.toHaveBeenCalled();
    });

    it("writes one ownership row per product however many lines bought it", async () => {
        db.order.findUnique.mockResolvedValueOnce({
            ...paidOrder,
            status: "PENDING",
            items: [
                { id: "i1", productId: "prod-1", name: "VIP", quantity: 1, metadata: {} },
                { id: "i2", productId: "prod-1", name: "VIP", quantity: 2, metadata: {} },
                { id: "i3", productId: "prod-2", name: "Kit", quantity: 1, metadata: {} },
            ],
        });

        await settleOrder(settlement);

        const chest = calls.find((c) => c.op === "chestItem.createMany")!;
        const owned = calls.find((c) => c.op === "ownedProduct.createMany")!;
        expect((chest.args.data as unknown[]).length).toBe(3);
        expect((owned.args.data as { productId: string }[]).map((r) => r.productId)).toEqual(["prod-1", "prod-2"]);
        expect(owned.args.skipDuplicates).toBe(true);
    });

    // Twelve line items used to be twelve queries before the gateway got its
    // answer, and a webhook has a timeout.
    it("reads the delivery commands once for the whole order", async () => {
        db.order.findUnique.mockResolvedValueOnce({
            ...paidOrder,
            status: "PENDING",
            items: [
                { id: "i1", productId: "prod-1", name: "VIP", quantity: 1, metadata: {} },
                { id: "i2", productId: "prod-2", name: "Kit", quantity: 1, metadata: {} },
            ],
        });

        await settleOrder(settlement);

        const queries = calls.filter((c) => c.op === "productCommand.findMany");
        expect(queries.length).toBe(1);
        expect(queries[0].args.where).toEqual({ productId: { in: ["prod-1", "prod-2"] } });
    });

    // A webhook left waiting is a webhook that gets retried, so the slow parts
    // are started and not awaited.
    it("does not make the gateway wait for the email or the delivery commands", async () => {
        db.order.findUnique.mockResolvedValueOnce({ ...paidOrder, status: "PENDING" });
        db.productCommand.findMany.mockResolvedValue([
            { productId: "prod-1", command: "give {player} vip", serverId: "srv-1", order: 0 },
        ]);
        sendOrderConfirmationEmail.mockRejectedValueOnce(new Error("smtp down"));

        const outcome = await settleOrder(settlement);

        expect(outcome.handled).toBe(true);
        expect(sendOrderConfirmationEmail).toHaveBeenCalledWith(expect.objectContaining({ to: expect.any(String) }));
        // Started, not awaited: the delivery claims its chest rows first, so
        // it reaches the commands a few turns after the gateway's answer.
        await vi.waitFor(() => expect(deliverProduct).toHaveBeenCalledWith(expect.objectContaining({ playerName: "Steve" })));
    });
});

describe("settleOrder, against a per-person limit", () => {
    const limited = { id: "prod-1", durationDays: null, grantsRoleId: null, perPersonLimit: 1, perPersonPeriod: "ever" };

    it("settles nothing that takes the buyer past their limit, and says so", async () => {
        // Two checkouts paid for one at a time: the other one is already paid.
        db.order.findUnique.mockResolvedValueOnce({ ...paidOrder, status: "PENDING" });
        db.product.findMany.mockImplementation(async () => [limited]);
        db.orderItem.aggregate.mockResolvedValueOnce({ _sum: { quantity: 1 } });

        const outcome = await settleOrder(settlement);

        expect(outcome.handled).toBe(false);
        expect(outcome.error).toMatch(/limit/);
        expect(db.payment.create).not.toHaveBeenCalled();
        expect(announceOrderCompleted).not.toHaveBeenCalled();
        expect(log.error).toHaveBeenCalled();
        // Counted under the lock the in-game purchase takes, leaving out the
        // order being settled.
        expect(executeRaw).toHaveBeenCalled();
        expect(JSON.stringify(db.orderItem.aggregate.mock.calls[0])).toContain('"not":"order-1"');
        db.product.findMany.mockImplementation(async () => []);
    });

    it("settles an order that stays inside the limit", async () => {
        db.order.findUnique.mockResolvedValueOnce({ ...paidOrder, status: "PENDING" });
        db.product.findMany.mockImplementation(async () => [limited]);

        const outcome = await settleOrder(settlement);

        expect(outcome).toEqual({ handled: true, duplicate: false, error: null });
        expect(db.payment.create).toHaveBeenCalled();
        db.product.findMany.mockImplementation(async () => []);
    });
});

describe("settleOrder, after the money went back", () => {
    it("settles nothing again for a refunded order", async () => {
        // A replayed success callback for a payment that was refunded must not
        // hand everything out a second time.
        db.order.findUnique.mockResolvedValueOnce({ ...paidOrder, status: "REFUNDED" });

        const outcome = await settleOrder(settlement);

        expect(outcome.handled).toBe(true);
        expect(db.order.updateMany).not.toHaveBeenCalled();
        expect(db.chestItem.createMany).not.toHaveBeenCalled();
    });

    it("settles nothing for a cancelled order, and says money arrived for it", async () => {
        db.order.findUnique.mockResolvedValueOnce({ ...paidOrder, status: "CANCELLED" });

        const outcome = await settleOrder(settlement);

        expect(outcome.error).toMatch(/cancelled/);
        expect(db.order.updateMany).not.toHaveBeenCalled();
        expect(log.error).toHaveBeenCalled();
    });
});

/**
 * An order holds what the store asked the gateway to collect, and a
 * settlement is held against it. The gateway's word for the amount used to be
 * the only one there was: a cent settled an order of fifty.
 */
describe("settleOrder, for an order placed with a creator's code", () => {
    const withCode = { ...paidOrder, status: "PENDING", total: 50, metadata: { playerName: "Steve", creatorCode: "ALEX" } };

    it("pays the creator once the money is here, inside the claim", async () => {
        db.order.findUnique.mockResolvedValueOnce(withCode);
        db.creatorCode.findUnique.mockResolvedValueOnce({ id: "cc1", code: "ALEX", creatorId: "creator", commissionPercent: 10 });

        await settleOrder(settlement);

        const update = calls.find((c) => c.op === "creatorCode.update");
        expect(update?.viaTx).toBe(true);
        expect(update?.args).toEqual({ where: { id: "cc1" }, data: { usageCount: { increment: 1 }, totalRevenue: { increment: 50 } } });
        expect(applyFiltersAsync).toHaveBeenCalledWith(
            "credit.change",
            expect.anything(),
            expect.objectContaining({ userId: "creator", amount: 5, type: "creator_commission" }),
        );
    });

    it("pays nothing again when another delivery of the payment won the claim", async () => {
        db.order.findUnique.mockResolvedValueOnce(withCode);
        db.order.updateMany.mockResolvedValueOnce({ count: 0 });

        await settleOrder(settlement);

        expect(db.creatorCode.update).not.toHaveBeenCalled();
    });

    it("writes on the order what the creator was paid, so a refund can take it back", async () => {
        db.order.findUnique.mockResolvedValueOnce(withCode);
        db.creatorCode.findUnique.mockResolvedValueOnce({ id: "cc1", code: "ALEX", creatorId: "creator", commissionPercent: 10 });
        applyFiltersAsync.mockImplementation(async (_hook: string, value: unknown) => ({ ...(value as object), applied: true }));

        await settleOrder(settlement);

        const written = calls.find((c) => c.op === "order.update");
        expect(written?.viaTx).toBe(true);
        expect(written?.args).toEqual({
            where: { id: "order-1" },
            data: {
                metadata: {
                    playerName: "Steve",
                    creatorCode: "ALEX",
                    commissionPaid: { codeId: "cc1", creatorId: "creator", amount: 5, total: 50 },
                },
            },
        });
    });

    it("writes nothing when the wallet did not take the credit", async () => {
        db.order.findUnique.mockResolvedValueOnce(withCode);
        db.creatorCode.findUnique.mockResolvedValueOnce({ id: "cc1", code: "ALEX", creatorId: "creator", commissionPercent: 10 });

        await settleOrder(settlement);

        const written = calls.find((c) => c.op === "order.update");
        expect((written?.args as { data?: { metadata?: { commissionPaid?: { amount: number } } } } | undefined)?.data?.metadata?.commissionPaid?.amount ?? 0).toBe(0);
    });
});

describe("settleOrder, against what was charged", () => {
    const charged = { ...paidOrder, status: "PENDING", chargeAmount: 42, chargeCurrency: "USD" };

    it("settles a payment of the amount charged", async () => {
        db.order.findUnique.mockResolvedValueOnce(charged);
        expect(await settleOrder(settlement)).toEqual({ handled: true, duplicate: false, error: null });
    });

    it("settles nothing for a payment of less, and says nobody recorded it", async () => {
        db.order.findUnique.mockResolvedValueOnce(charged);

        const outcome = await settleOrder({ ...settlement, amount: 0.01 });

        // Not handled: the gateway answers its provider with a failure, so the
        // operator hears of it, rather than telling the buyer it went through.
        expect(outcome.handled).toBe(false);
        expect(outcome.error).toBeTruthy();
        expect(db.order.updateMany).not.toHaveBeenCalled();
        expect(db.chestItem.createMany).not.toHaveBeenCalled();
    });

    it("settles nothing for a payment in another currency", async () => {
        db.order.findUnique.mockResolvedValueOnce(charged);
        const outcome = await settleOrder({ ...settlement, currency: "TRY" });
        expect(outcome.handled).toBe(false);
        expect(db.order.updateMany).not.toHaveBeenCalled();
    });

    it("records the charge as the payment when the provider does not report the amount", async () => {
        db.order.findUnique.mockResolvedValueOnce(charged);

        expect(await settleOrder({ ...settlement, amount: null, currency: null })).toMatchObject({ handled: true, error: null });
        expect(db.payment.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ amount: 42, currency: "usd" }) }),
        );
    });

    // Orders placed before the charge was written down have nothing to hold a
    // settlement against, and refusing them would strand the ones in flight.
    it("settles an order placed before charges were recorded as it always did", async () => {
        db.order.findUnique.mockResolvedValueOnce({ ...paidOrder, status: "PENDING", chargeAmount: null, chargeCurrency: null });
        expect(await settleOrder({ ...settlement, amount: 0.01 })).toMatchObject({ handled: true, error: null });
    });
});

describe("settlePayment", () => {
    const topUp = {
        id: "topup-1",
        userId: "user-1",
        credits: 1200,
        amount: 10,
        currency: "USD",
        status: "PENDING",
    };

    /**
     * Eight gateways report every payment as an order: they have no field to
     * carry the kind in. A top-up settled through one of them looked
     * for an order with the buyer's id, found none, and told the buyer it had
     * worked. The store reads the kind from its own records now.
     */
    it("settles a top-up whatever kind the gateway called it", async () => {
        db.creditTopUp.findUnique.mockResolvedValueOnce(topUp);

        const outcome = await settlePayment({ ...settlement, kind: "order", reference: "topup-1", amount: 10 });

        expect(outcome).toEqual({ handled: true, duplicate: false, error: null });
        expect(applyFiltersAsync).toHaveBeenCalledWith(
            "credit.change",
            expect.anything(),
            expect.objectContaining({ userId: "user-1", amount: 1200, type: "credit_purchase" }),
        );
        expect(db.order.findUnique).not.toHaveBeenCalled();
    });

    it("settles an order when the reference is not a top-up", async () => {
        db.order.findUnique.mockResolvedValueOnce({ ...paidOrder, status: "PENDING" });
        expect(await settlePayment(settlement)).toEqual({ handled: true, duplicate: false, error: null });
        expect(db.order.updateMany).toHaveBeenCalled();
    });
});

describe("settleCredits", () => {
    const topUp = {
        id: "topup-1",
        userId: "user-1",
        credits: 1200,
        amount: 10,
        currency: "USD",
        status: "PENDING",
    };
    const settled: PaymentSettlement = {
        kind: "credits",
        reference: "topup-1",
        provider: "stripe",
        providerRef: "pi_credit",
        amount: 10,
        currency: "USD",
        metadata: {},
    };

    it("credits what the top-up sold, not what the gateway carried back", async () => {
        // The metadata travels through the provider, and through the buyer's
        // browser for some gateways. The top-up row is the store's own.
        const outcome = await settleCredits({ ...settled, metadata: { userId: "someone-else", creditAmount: "1000000" } }, topUp);

        expect(outcome).toEqual({ handled: true, duplicate: false, error: null });
        expect(applyFiltersAsync).toHaveBeenCalledWith(
            "credit.change",
            expect.anything(),
            expect.objectContaining({ userId: "user-1", amount: 1200 }),
        );
    });

    it("claims the top-up in the transaction that credits it", async () => {
        await settleCredits(settled, topUp);

        expect(calls.find((c) => c.op === "creditTopUp.updateMany")).toMatchObject({
            viaTx: true,
            args: { where: { id: "topup-1", status: "PENDING" }, data: { status: "COMPLETED" } },
        });
    });

    it("credits nothing when another delivery claimed the top-up first", async () => {
        db.creditTopUp.updateMany.mockResolvedValueOnce({ count: 0 });

        expect(await settleCredits(settled, topUp)).toEqual({ handled: true, duplicate: true, error: null });
        expect(applyFiltersAsync).not.toHaveBeenCalledWith("credit.change", expect.anything(), expect.anything());
    });

    it("says already settled for a top-up that is complete", async () => {
        expect(await settleCredits(settled, { ...topUp, status: "COMPLETED" })).toEqual({
            handled: true,
            duplicate: true,
            error: null,
        });
        expect(db.creditTopUp.updateMany).not.toHaveBeenCalled();
    });

    it("credits nothing for a payment of less than the top-up cost", async () => {
        const outcome = await settleCredits({ ...settled, amount: 0.01 }, topUp);

        expect(outcome.handled).toBe(false);
        expect(db.creditTopUp.updateMany).not.toHaveBeenCalled();
        expect(applyFiltersAsync).not.toHaveBeenCalledWith("credit.change", expect.anything(), expect.anything());
    });

    /**
     * The duplicate check used to be `findFirst` on
     * `description: { contains: providerRef }` - a scan of the whole ledger,
     * and a read that two concurrent deliveries both lose: neither found a
     * row and both credited the account. The row's primary key is the
     * idempotency key now.
     */
    it("keys the ledger row on the gateway's own reference", async () => {
        await settleCredits(settled, topUp);

        expect(db.creditTransaction.findUnique).not.toHaveBeenCalled();
        expect(applyFiltersAsync).toHaveBeenCalledWith(
            "credit.change",
            expect.anything(),
            expect.objectContaining({ ledgerId: "credit:stripe:pi_credit" }),
        );
    });

    it("treats a duplicate key from a concurrent delivery as already settled", async () => {
        applyFiltersAsync.mockRejectedValueOnce(
            Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
        );

        expect(await settleCredits(settled, topUp)).toEqual({ handled: true, duplicate: true, error: null });
    });

    it("does not swallow a failure that is not a duplicate", async () => {
        applyFiltersAsync.mockRejectedValueOnce(
            Object.assign(new Error("connection lost"), { code: "P1001" }),
        );

        await expect(settleCredits(settled, topUp)).rejects.toThrow("connection lost");
    });

    it("refuses a top-up whose buyer's account is gone", async () => {
        const outcome = await settleCredits(settled, { ...topUp, userId: null });

        expect(outcome.error).toBeTruthy();
        expect(applyFiltersAsync).not.toHaveBeenCalledWith("credit.change", expect.anything(), expect.anything());
    });
});

describe("cancelPayment", () => {
    it("cancels a top-up the buyer walked away from", async () => {
        db.creditTopUp.findUnique.mockResolvedValueOnce({ id: "topup-1", status: "PENDING" });

        expect(await cancelPayment("topup-1")).toMatchObject({ handled: true });
        expect(db.creditTopUp.updateMany).toHaveBeenCalledWith({
            where: { id: "topup-1", status: "PENDING" },
            data: { status: "CANCELLED" },
        });
        expect(db.order.findUnique).not.toHaveBeenCalled();
    });

    it("hands anything else to the order it names", async () => {
        db.order.findUnique.mockResolvedValueOnce({ id: "order-1", status: "PENDING" });

        expect(await cancelPayment("order-1")).toMatchObject({ handled: true });
        expect(db.order.update).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { status: "CANCELLED" } });
    });
});

describe("voidOrder", () => {
    it("cancels an order the buyer walked away from", async () => {
        db.order.findUnique.mockResolvedValueOnce({ id: "order-1", status: "PENDING" });

        const outcome = await voidOrder("order-1");

        expect(outcome.handled).toBe(true);
        expect(db.order.update).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { status: "CANCELLED" } });
    });

    it("never turns a refunded order into a cancelled one", async () => {
        db.order.findUnique.mockResolvedValueOnce({ id: "order-1", status: "REFUNDED" });

        expect((await voidOrder("order-1")).duplicate).toBe(true);
        expect(db.order.update).not.toHaveBeenCalled();
    });

    // Providers send an "expired" event for the session, which can land after
    // the payment succeeded through another route.
    it("never cancels an order that was already paid for", async () => {
        db.order.findUnique.mockResolvedValueOnce({ id: "order-1", status: "COMPLETED" });

        const outcome = await voidOrder("order-1");

        expect(outcome).toEqual({ handled: true, duplicate: true, error: null });
        expect(db.order.update).not.toHaveBeenCalled();
    });
});

describe("refundPayment", () => {
    it("marks the payment and its order refunded", async () => {
        db.payment.findFirst.mockResolvedValueOnce({ id: "pay-1", orderId: "order-1", status: "COMPLETED" });

        const outcome = await refundPayment("stripe", "pi_123");

        expect(outcome.handled).toBe(true);
        // Conditional, like every other claim here: two refund notifications
        // arriving together both read COMPLETED, and only the `where` stops
        // the second one putting the stock back a second time.
        expect(db.payment.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: "pay-1", status: { not: "REFUNDED" } },
                data: { status: "REFUNDED" },
            }),
        );
        expect(db.order.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: "order-1" }, data: { status: "REFUNDED" } }),
        );
    });

    it("is safe to replay on an already refunded payment", async () => {
        db.payment.findFirst.mockResolvedValueOnce({ id: "pay-1", orderId: "order-1", status: "REFUNDED" });

        expect(await refundPayment("stripe", "pi_123")).toEqual({ handled: true, duplicate: true, error: null });
        expect(db.payment.updateMany).not.toHaveBeenCalled();
    });

    const refunding = {
        id: "order-1",
        userId: "user-1",
        metadata: { playerName: "Steve" },
        items: [{ id: "i1", productId: "prod-1", name: "VIP", quantity: 1, price: 42, metadata: {} }],
    };

    it("takes back what the order granted and nobody has been handed yet", async () => {
        db.payment.findFirst.mockResolvedValueOnce({ id: "pay-1", orderId: "order-1", status: "COMPLETED" });
        db.order.findUnique.mockResolvedValueOnce(refunding);
        db.ownedProduct.findMany.mockResolvedValueOnce([{ id: "own-1", userId: "user-1", productId: "prod-1", expiresAt: null }]);
        db.product.findMany.mockImplementation(async () => [{ id: "prod-1", durationDays: null, grantsRoleId: null }]);

        expect((await refundPayment("stripe", "pi_123")).handled).toBe(true);

        // Inside the claim, so a second refund notification takes nothing twice.
        const inTx = calls.filter((c) => c.viaTx).map((c) => c.op);
        expect(inTx).toContain("chestItem.deleteMany");
        expect(inTx).toContain("ownedProduct.deleteMany");
        expect(db.chestItem.deleteMany).toHaveBeenCalledWith({ where: { orderId: "order-1", isRedeemed: false } });
        expect(db.ownedProduct.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["own-1"] } } });
        // The cashback is the wallet's to take back; it hears of the refund.
        expect(announceOrderRefunded).toHaveBeenCalledWith("order-1");
        db.product.findMany.mockImplementation(async () => []);
    });

    it("takes off a timed ownership only the time this order added", async () => {
        const ends = new Date(Date.now() + 40 * 86_400_000);
        db.payment.findFirst.mockResolvedValueOnce({ id: "pay-1", orderId: "order-1", status: "COMPLETED" });
        db.order.findUnique.mockResolvedValueOnce(refunding);
        db.ownedProduct.findMany.mockResolvedValueOnce([{ id: "own-1", userId: "user-1", productId: "prod-1", expiresAt: ends }]);
        db.product.findMany.mockImplementation(async () => [{ id: "prod-1", durationDays: 30, grantsRoleId: null }]);

        await refundPayment("stripe", "pi_123");

        expect(db.ownedProduct.update).toHaveBeenCalledWith({
            where: { id: "own-1" },
            data: { expiresAt: new Date(ends.getTime() - 30 * 86_400_000) },
        });
        expect(db.ownedProduct.deleteMany).not.toHaveBeenCalled();
        db.product.findMany.mockImplementation(async () => []);
    });

    it("writes on the order what was already delivered in game", async () => {
        // A command that ran on a game server cannot be run backwards. The
        // order says which lines those were, for the operator to undo by hand.
        db.payment.findFirst.mockResolvedValueOnce({ id: "pay-1", orderId: "order-1", status: "COMPLETED" });
        db.order.findUnique.mockResolvedValueOnce(refunding);
        db.chestItem.findMany.mockResolvedValueOnce([{ productName: "VIP" }]);

        await refundPayment("stripe", "pi_123");

        expect(db.order.update).toHaveBeenCalledWith({
            where: { id: "order-1" },
            data: { metadata: { playerName: "Steve", keptInGame: ["VIP"] } },
        });
    });

    it("takes back the rank the order granted when nothing else still grants it", async () => {
        db.payment.findFirst.mockResolvedValueOnce({ id: "pay-1", orderId: "order-1", status: "COMPLETED" });
        db.order.findUnique.mockResolvedValueOnce(refunding);
        db.ownedProduct.findMany.mockResolvedValueOnce([{ id: "own-1", userId: "user-1", productId: "prod-1", expiresAt: null }]);
        db.product.findMany.mockImplementation(async () => [{ id: "prod-1", durationDays: null, grantsRoleId: "role-vip" }]);
        rolesHeldBy.mockResolvedValueOnce([{ roleId: "role-vip", source: "store:product" }]);

        await refundPayment("stripe", "pi_123");

        expect(revokeRole).toHaveBeenCalledWith("user-1", "role-vip");
        db.product.findMany.mockImplementation(async () => []);
    });

    it("leaves a rank an administrator gave by hand", async () => {
        db.payment.findFirst.mockResolvedValueOnce({ id: "pay-1", orderId: "order-1", status: "COMPLETED" });
        db.order.findUnique.mockResolvedValueOnce(refunding);
        db.ownedProduct.findMany.mockResolvedValueOnce([{ id: "own-1", userId: "user-1", productId: "prod-1", expiresAt: null }]);
        db.product.findMany.mockImplementation(async () => [{ id: "prod-1", durationDays: null, grantsRoleId: "role-vip" }]);
        rolesHeldBy.mockResolvedValueOnce([{ roleId: "role-vip", source: "manual" }]);

        await refundPayment("stripe", "pi_123");

        expect(revokeRole).not.toHaveBeenCalled();
        db.product.findMany.mockImplementation(async () => []);
    });

    it("takes back the credits of a refunded top-up, as far as they are unspent", async () => {
        db.payment.findFirst.mockResolvedValueOnce(null);
        db.creditTopUp.findFirst.mockResolvedValueOnce({ id: "tu-1", userId: "user-1", credits: 100, refundedAt: null });
        db.user.findUnique.mockResolvedValueOnce({ creditBalance: 60 });

        const outcome = await refundPayment("stripe", "pi_123");

        expect(outcome).toEqual({ handled: true, duplicate: false, error: null });
        expect(db.creditTopUp.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: "tu-1", refundedAt: null } }),
        );
        expect(applyFiltersAsync).toHaveBeenCalledWith(
            "credit.change",
            expect.anything(),
            expect.objectContaining({ userId: "user-1", amount: -60, type: "payment_refund" }),
        );
        // Forty were spent before the money went back: loud, for the operator.
        expect(log.error).toHaveBeenCalled();
    });

    // Two gateways can hold the same provider reference only by accident, but a
    // refund for a payment this site never took should not touch an order.
    it("answers with an error when the payment is not ours", async () => {
        db.payment.findFirst.mockResolvedValueOnce(null);

        const outcome = await refundPayment("stripe", "pi_unknown");

        expect(outcome.error).toMatch(/unknown payment/i);
        expect(db.order.update).not.toHaveBeenCalled();
    });
});

describe("refundPayment, for an order whose creator was paid", () => {
    const payment = { id: "pay-1", orderId: "order-1", status: "COMPLETED" };
    const paid = {
        ...paidOrder,
        status: "COMPLETED",
        total: 50,
        metadata: {
            playerName: "Steve",
            creatorCode: "ALEX",
            commissionPaid: { codeId: "cc1", creatorId: "creator", amount: 5, total: 50 },
        },
    };
    const moves = () => applyFiltersAsync.mock.calls.filter(([hook]) => hook === "credit.change");

    /** The creator's balance as the wallet answers it, and a wallet that takes what it is asked. */
    function creatorHolds(balance: number | null) {
        applyFiltersAsync.mockImplementation(async (hook: string, value: unknown) =>
            hook === "credits.balance" ? balance : hook === "credit.change" ? { applied: true } : value,
        );
    }

    beforeEach(() => {
        db.payment.findFirst.mockResolvedValueOnce(payment);
        db.order.findUnique.mockResolvedValueOnce(paid);
        creatorHolds(40);
    });

    it("takes the commission back from the creator once, inside the refund's claim", async () => {
        await refundPayment("stripe", "pi_123");

        expect(moves()).toHaveLength(1);
        expect(moves()[0][2]).toEqual(
            expect.objectContaining({
                userId: "creator",
                amount: -5,
                type: "creator_commission",
                ledgerId: "commission-refund:order-1",
                tx: expect.anything(),
            }),
        );
    });

    it("counts the use and the revenue back off the code", async () => {
        await refundPayment("stripe", "pi_123");

        const undone = calls.find((c) => c.op === "creatorCode.updateMany");
        expect(undone?.viaTx).toBe(true);
        expect(undone?.args).toEqual({
            where: { id: "cc1", usageCount: { gt: 0 } },
            data: { usageCount: { decrement: 1 }, totalRevenue: { decrement: 50 } },
        });
    });

    it("takes back only what the creator still holds, and says so", async () => {
        creatorHolds(3.5);

        await refundPayment("stripe", "pi_123");

        expect(moves()[0][2]).toEqual(expect.objectContaining({ amount: -3.5 }));
        expect(log.warn).toHaveBeenCalled();
    });

    it("takes nothing when the creator has spent it all, and still counts the code back", async () => {
        creatorHolds(0);

        await refundPayment("stripe", "pi_123");

        expect(moves()).toHaveLength(0);
        expect(db.creatorCode.updateMany).toHaveBeenCalled();
    });

    it("takes nothing when the order paid no commission", async () => {
        db.order.findUnique.mockReset();
        db.order.findUnique.mockResolvedValueOnce({ ...paid, metadata: { playerName: "Steve", creatorCode: "ALEX" } });

        await refundPayment("stripe", "pi_123");

        expect(moves()).toHaveLength(0);
        expect(db.creatorCode.updateMany).not.toHaveBeenCalled();
    });

    it("takes nothing a second time when another notice of the refund won the claim", async () => {
        db.payment.updateMany.mockResolvedValueOnce({ count: 0 });

        await refundPayment("stripe", "pi_123");

        expect(moves()).toHaveLength(0);
        expect(db.creatorCode.updateMany).not.toHaveBeenCalled();
    });

    it("takes nothing a second time when the payment is already refunded", async () => {
        db.payment.findFirst.mockReset();
        db.payment.findFirst.mockResolvedValueOnce({ ...payment, status: "REFUNDED" });

        await refundPayment("stripe", "pi_123");

        expect(moves()).toHaveLength(0);
    });
});

describe("applySubscriptionChange", () => {
    const change: SubscriptionChange = {
        provider: "stripe",
        providerRef: "sub_1",
        userId: "user-1",
        productId: "prod-1",
        status: "active",
        currentPeriodEnd: "2026-10-01T00:00:00.000Z",
        ended: false,
    };

    it("starts a plan and grants the product it pays for", async () => {
        db.subscription.findFirst.mockResolvedValueOnce(null);

        const outcome = await applySubscriptionChange(change);

        expect(outcome.handled).toBe(true);
        expect(db.subscription.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ userId: "user-1", productId: "prod-1", status: "active" }),
            }),
        );
        expect(db.ownedProduct.upsert).toHaveBeenCalledTimes(1);
    });

    it("renews an existing plan without granting the product again", async () => {
        db.subscription.findFirst.mockResolvedValueOnce({ id: "sub-row", status: "active", userId: "user-1", productId: "prod-1" });

        await applySubscriptionChange(change);

        expect(db.subscription.update).toHaveBeenCalledTimes(1);
        expect(db.subscription.create).not.toHaveBeenCalled();
        expect(db.ownedProduct.upsert).not.toHaveBeenCalled();
    });

    // Selling access by the month means access ends with the month.
    it("withdraws the product when the plan ends", async () => {
        db.subscription.findFirst.mockResolvedValueOnce({ id: "sub-row", status: "active", userId: "user-1", productId: "prod-1" });

        const outcome = await applySubscriptionChange({ ...change, status: "canceled", ended: true });

        expect(outcome.handled).toBe(true);
        expect(db.ownedProduct.deleteMany).toHaveBeenCalledWith({
            where: { userId: "user-1", productId: "prod-1" },
        });
    });

    // A plan and the product it pays for arrive together or not at all. Written
    // in sequence, a failure in between left a subscription row with nothing
    // granted - and the retry found that row, took the renewal branch, and
    // only updated its status, so the subscriber paid every month for nothing.
    it("starts the plan and grants the product in one transaction", async () => {
        db.subscription.findFirst.mockResolvedValueOnce(null);

        await applySubscriptionChange(change);

        expect(calls.filter((c) => c.viaTx).map((c) => c.op)).toEqual([
            "subscription.create",
            "ownedProduct.upsert",
        ]);
    });

    // And the same going out: a cancelled plan whose ownership row survived
    // left the subscriber with what they had stopped paying for, forever,
    // because the replay guard answered every retry with "already done".
    it("cancels the plan and withdraws the product in one transaction, conditionally", async () => {
        db.subscription.findFirst.mockResolvedValueOnce({ id: "sub-row", status: "active", userId: "user-1", productId: "prod-1" });

        await applySubscriptionChange({ ...change, status: "canceled", ended: true });

        expect(db.subscription.updateMany).toHaveBeenCalledWith({
            where: { id: "sub-row", status: { not: "canceled" } },
            data: expect.objectContaining({ status: "canceled" }),
        });
        expect(calls.filter((c) => c.viaTx).map((c) => c.op)).toEqual([
            "subscription.updateMany",
            "ownedProduct.deleteMany",
        ]);
    });

    it("withdraws nothing when another cancellation event won the claim", async () => {
        db.subscription.findFirst.mockResolvedValueOnce({ id: "sub-row", status: "active", userId: "user-1", productId: "prod-1" });
        db.subscription.updateMany.mockResolvedValueOnce({ count: 0 });

        expect(await applySubscriptionChange({ ...change, ended: true })).toEqual({
            handled: true,
            duplicate: true,
            error: null,
        });
        expect(db.ownedProduct.deleteMany).not.toHaveBeenCalled();
    });

    it("is safe to replay a cancellation", async () => {
        db.subscription.findFirst.mockResolvedValueOnce({ id: "sub-row", status: "canceled", userId: "user-1", productId: "prod-1" });

        expect(await applySubscriptionChange({ ...change, ended: true })).toEqual({
            handled: true,
            duplicate: true,
            error: null,
        });
        expect(db.ownedProduct.deleteMany).not.toHaveBeenCalled();
    });
});
