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
    },
    ownedProduct: {
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
    // Settlement takes stock off the shelf now. These fixtures sell products
    // the shop does not count - `stock: null` - so the read finds nothing to
    // take and no product is written to. `a-limited-product-runs-out.test.ts`
    // is where the counting itself is tested.
    product: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
    user: { update: vi.fn(async () => ({})) },
    creditTransaction: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
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
const txClient = trace(models, true);
const prismaClient = { ...trace(models, false), $transaction: db.$transaction };

vi.mock("@/core/sdk/server", () => ({
    prisma: prismaClient,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
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
vi.mock("@/modules/store/lib/order-events", () => ({ announceOrderCompleted }));

const { settleOrder, settleCredits, voidOrder, refundPayment, applySubscriptionChange } = await import(
    "@/modules/store/lib/fulfilment"
);

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
    db.order.update.mockResolvedValue({});
    db.order.updateMany.mockResolvedValue({ count: 1 });
    db.subscription.updateMany.mockResolvedValue({ count: 1 });
    db.chestItem.createMany.mockResolvedValue({ count: 1 });
    db.ownedProduct.createMany.mockResolvedValue({ count: 1 });
    db.productCommand.findMany.mockResolvedValue([]);
    db.creditTransaction.findUnique.mockResolvedValue(null);
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
            where: { id: "order-1", status: { not: "COMPLETED" } },
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

describe("settleCredits", () => {
    const topUp: PaymentSettlement = {
        kind: "credits",
        reference: "user-1",
        provider: "stripe",
        providerRef: "pi_credit",
        amount: 25,
        currency: "USD",
        metadata: { userId: "user-1", creditAmount: "25" },
    };

    it("asks for the credits the store told the gateway to carry", async () => {
        const outcome = await settleCredits(topUp);

        expect(outcome).toEqual({ handled: true, duplicate: false, error: null });
        expect(applyFiltersAsync).toHaveBeenCalledWith(
            "credit.change",
            expect.anything(),
            expect.objectContaining({ userId: "user-1", amount: 25, type: "credit_purchase" }),
        );
    });

    /**
     * The duplicate check used to be `findFirst` on
     * `description: { contains: providerRef }` - a scan of the whole ledger,
     * and a read that two concurrent deliveries both lose: neither found a
     * row and both credited the account. The row's primary key is the
     * idempotency key now.
     */
    it("keys the ledger row on the gateway's own reference", async () => {
        await settleCredits(topUp);

        // There is no read before the write any more: the ledger belongs to
        // another module, and the duplicate key is the answer rather than a
        // second opinion about it.
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

        expect(await settleCredits(topUp)).toEqual({ handled: true, duplicate: true, error: null });
    });

    it("does not swallow a failure that is not a duplicate", async () => {
        applyFiltersAsync.mockRejectedValueOnce(
            Object.assign(new Error("connection lost"), { code: "P1001" }),
        );

        await expect(settleCredits(topUp)).rejects.toThrow("connection lost");
    });

    it("refuses a top-up with no buyer or no amount", async () => {
        const outcome = await settleCredits({ ...topUp, metadata: { userId: "user-1" } });

        expect(outcome.error).toBeTruthy();
        expect(db.user.update).not.toHaveBeenCalled();
    });
});

describe("voidOrder", () => {
    it("cancels an order the buyer walked away from", async () => {
        db.order.findUnique.mockResolvedValueOnce({ id: "order-1", status: "PENDING" });

        const outcome = await voidOrder("order-1");

        expect(outcome.handled).toBe(true);
        expect(db.order.update).toHaveBeenCalledWith({ where: { id: "order-1" }, data: { status: "CANCELLED" } });
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

    // Two gateways can hold the same provider reference only by accident, but a
    // refund for a payment this site never took should not touch an order.
    it("answers with an error when the payment is not ours", async () => {
        db.payment.findFirst.mockResolvedValueOnce(null);

        const outcome = await refundPayment("stripe", "pi_unknown");

        expect(outcome.error).toMatch(/unknown payment/i);
        expect(db.order.update).not.toHaveBeenCalled();
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
