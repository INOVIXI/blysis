/**
 * A status dropdown that wrote a word and did nothing else.
 *
 * The admin order screen lets an operator set the status, and setting it to
 * COMPLETED wrote the column. Nothing else happened: no chest, no ownership,
 * no role, no delivery command, no stock off the shelf, no sale counted.
 *
 * That is worse than a missing feature, because it looks like it worked. The
 * screen turns green, the order says Completed, and the buyer has nothing.
 * It is also the exact button an operator presses to confirm a bank transfer,
 * which is the whole of paying by hand.
 *
 * So marking an order paid takes the same path a gateway's webhook takes, and
 * cancelling and refunding take theirs. What the dropdown must never be is a
 * second way to change the same state, drifting from the first the day either
 * changes.
 *
 * The reverse matters too: PROCESSING and PENDING are notes an operator makes
 * about an order already dealt with, and turning one of those into a grant
 * would hand out a second copy of everything on every edit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const settleOrder = vi.fn(async () => ({ handled: true, duplicate: false, error: null }));
const voidOrder = vi.fn(async () => ({ handled: true, duplicate: false, error: null }));
const refundPayment = vi.fn(async () => ({ handled: true, duplicate: false, error: null }));

const db = {
    order: {
        findUnique: vi.fn(),
        update: vi.fn(async () => ({ id: "order-1", items: [], user: null })),
    },
    payment: { findFirst: vi.fn(async () => null) },
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    isAdmin: vi.fn(async () => true),
    // Whoever serves the orders, which is the job this file is about.
    hasPermission: vi.fn(async () => true),
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    logActivity: vi.fn(async () => {}),
    readJsonBody: vi.fn(async (request: Request) => request.json()),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "admin-1" } })) }));
vi.mock("@/modules/store/lib/fulfilment", () => ({ settleOrder, voidOrder, refundPayment }));

const { PATCH } = await import("@/modules/store/api/orders/[id]/route");

const setStatus = (status: string) =>
    PATCH(
        new Request("http://localhost/api/v1/store/orders/order-1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
        }) as never,
        { params: Promise.resolve({ id: "order-1" }) },
    );

const pending = {
    id: "order-1",
    status: "PENDING",
    total: "42.00",
    currency: "USD",
    paymentMethod: "manual-payment",
    paymentId: null,
};

beforeEach(() => {
    vi.clearAllMocks();
    db.order.findUnique.mockResolvedValue(pending);
    db.order.update.mockResolvedValue({ id: "order-1", items: [], user: null });
    db.payment.findFirst.mockResolvedValue(null);
});

describe("marking an unpaid order paid", () => {
    it("grants what was bought, down the same path a gateway takes", async () => {
        const res = await setStatus("COMPLETED");
        expect(res.status).toBe(200);
        expect(settleOrder).toHaveBeenCalledWith(
            expect.objectContaining({ kind: "order", reference: "order-1", amount: 42, currency: "USD" }),
        );
    });

    it("settles at the order's own total, never a number from the request", async () => {
        db.order.findUnique.mockResolvedValue({ ...pending, total: "500.00" });
        await setStatus("COMPLETED");
        expect(settleOrder).toHaveBeenCalledWith(expect.objectContaining({ amount: 500 }));
    });

    it("does not also write the status itself, which would be a second way to set it", async () => {
        // Settlement writes COMPLETED inside the claim that makes it happen
        // once. A write beside it can only disagree with that claim.
        await setStatus("COMPLETED");
        const wrote = db.order.update.mock.calls.map((call) => (call[0] as { data: Record<string, unknown> }).data);
        expect(wrote.some((data) => data.status === "COMPLETED")).toBe(false);
    });

    it("says so when settlement refused", async () => {
        settleOrder.mockResolvedValue({ handled: false, duplicate: false, error: "no" });
        const res = await setStatus("COMPLETED");
        expect(res.status).toBe(500);
    });
});

describe("marking an order paid that already is", () => {
    it("grants nothing a second time", async () => {
        db.order.findUnique.mockResolvedValue({ ...pending, status: "COMPLETED" });
        settleOrder.mockResolvedValue({ handled: true, duplicate: true, error: null });

        const res = await setStatus("COMPLETED");

        expect(res.status).toBe(200);
        // Settlement is asked, and answers "already". That is its job, not
        // this route's: the claim is what makes it true under two requests.
        expect(settleOrder).toHaveBeenCalledTimes(1);
    });
});

describe("the other statuses", () => {
    it("cancels down the cancelling path", async () => {
        await setStatus("CANCELLED");
        expect(voidOrder).toHaveBeenCalledWith("order-1");
        expect(settleOrder).not.toHaveBeenCalled();
    });

    it("refunds down the refunding path, which puts the stock back", async () => {
        db.order.findUnique.mockResolvedValue({ ...pending, status: "COMPLETED", paymentId: "manual:order-1" });
        await setStatus("REFUNDED");
        expect(refundPayment).toHaveBeenCalledWith("manual-payment", "manual:order-1");
    });

    it("says a refund needs a payment to refund", async () => {
        db.order.findUnique.mockResolvedValue({ ...pending, status: "COMPLETED", paymentId: null });
        const res = await setStatus("REFUNDED");
        expect(res.status).toBe(400);
        expect(refundPayment).not.toHaveBeenCalled();
    });

    it("writes a note like PROCESSING as a plain status, granting nothing", async () => {
        const res = await setStatus("PROCESSING");
        expect(res.status).toBe(200);
        expect(settleOrder).not.toHaveBeenCalled();
        expect(voidOrder).not.toHaveBeenCalled();
        expect(db.order.update).toHaveBeenCalled();
    });
});
