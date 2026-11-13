// @vitest-environment node
/**
 * An operator adds credits to a member's balance or takes them off, by hand.
 *
 * The only door for this was an endpoint nothing called, which could add and
 * not remove and took no reason. A balance an operator changed is the one a
 * member asks about, so the reason is required and lands on the row the
 * member reads. A removal stops at zero like every other debit, because a
 * negative balance is a debt; going below zero is a choice made on purpose.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/** One member's balance and ledger, held in memory, answering the calls the movement makes. */
function wallet(start: number) {
    const state = { balance: start, rows: [] as { userId: string | null; amount: number; type: string; description: string | null }[] };
    const tx = {
        user: {
            updateMany: vi.fn(async ({ where, data }: { where: { creditBalance: { gte: number } }; data: { creditBalance: { decrement: number } } }) => {
                if (state.balance < where.creditBalance.gte) return { count: 0 };
                state.balance -= data.creditBalance.decrement;
                return { count: 1 };
            }),
            update: vi.fn(async ({ data }: { data: { creditBalance: { increment?: number; decrement?: number } } }) => {
                state.balance += data.creditBalance.increment ?? 0;
                state.balance -= data.creditBalance.decrement ?? 0;
                return {};
            }),
            findUnique: vi.fn(async () => ({ id: "m1", username: "Steve", creditBalance: state.balance })),
            findUniqueOrThrow: vi.fn(async () => ({ creditBalance: state.balance })),
        },
        creditTransaction: {
            create: vi.fn(async ({ data }: { data: (typeof state.rows)[number] }) => {
                state.rows.push(data);
                return data;
            }),
        },
    };
    return { state, tx };
}

let current = wallet(0);
const session = { user: { id: "admin-1" } as { id: string } | undefined };
const hasPermission = vi.fn(async (_userId: string, _permission: string) => true);
const logActivity = vi.fn(async (_entry: Record<string, unknown>) => undefined);
const doActionAsync = vi.fn(async (_hook: string, _payload: unknown) => undefined);

vi.mock("@/core/sdk/auth", () => ({ auth: vi.fn(async () => (session.user ? session : null)) }));
vi.mock("@/core/sdk/server", () => ({
    hasPermission,
    logActivity,
    readJsonBody: async (request: Request) => request.json(),
    prisma: {
        user: { findUnique: (...args: unknown[]) => (current.tx.user.findUnique as (...a: unknown[]) => unknown)(...args) },
        $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(current.tx),
    },
}));
vi.mock("@/core/sdk", () => ({ doActionAsync }));

const { adjustBalance, adjustmentRefusal } = await import("@/modules/credits/lib/adjust");
const { POST } = await import("@/modules/credits/api/credits/admin/adjust/route");

const post = (body: Record<string, unknown>) =>
    POST(new NextRequest("http://site.test/api/v1/credits/admin/adjust", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
    vi.clearAllMocks();
    current = wallet(50);
    session.user = { id: "admin-1" };
    hasPermission.mockResolvedValue(true);
});

describe("the rules for a change by hand", () => {
    const change = (over: Partial<Parameters<typeof adjustmentRefusal>[0]> = {}) =>
        adjustmentRefusal({ amount: 10, reason: "Bug bounty", ...over }, 50);

    it("accepts an addition or a removal the balance covers", () => {
        expect(change()).toBeNull();
        expect(change({ amount: -50 })).toBeNull();
    });

    it("refuses nothing, a fraction and more than one change may move", () => {
        expect(change({ amount: 0 })).toBe("credits_adjust_zero");
        expect(change({ amount: 2.5 })).toBe("credits_adjust_zero");
        expect(change({ amount: 1_000_001 })).toBe("credits_adjust_too_large");
        expect(change({ amount: -1_000_001 })).toBe("credits_adjust_too_large");
    });

    it("refuses a change without a reason, blank included", () => {
        expect(change({ reason: "" })).toBe("credits_adjust_no_reason");
        expect(change({ reason: "   " })).toBe("credits_adjust_no_reason");
    });

    it("refuses to take a balance below zero unless that was allowed", () => {
        expect(change({ amount: -51 })).toBe("credits_adjust_below_zero");
        expect(change({ amount: -51, allowNegative: true })).toBeNull();
    });
});

describe("the movement", () => {
    it("adds and writes the reason on the row the member reads", async () => {
        await expect(adjustBalance(current.tx as never, { userId: "m1", amount: 25, reason: " Bug bounty " }, 50)).resolves.toBe(true);
        expect(current.state.balance).toBe(75);
        expect(current.state.rows).toEqual([{ userId: "m1", amount: 25, type: "admin_grant", description: "Bug bounty" }]);
    });

    it("takes nothing when the balance was spent before the debit, whatever was read first", async () => {
        current.state.balance = 10;
        await expect(adjustBalance(current.tx as never, { userId: "m1", amount: -20, reason: "Chargeback" }, 50)).resolves.toBe(false);
        expect(current.state.balance).toBe(10);
        expect(current.state.rows).toEqual([]);
    });

    it("goes below zero only when that was allowed, with its row", async () => {
        current.state.balance = 10;
        await expect(
            adjustBalance(current.tx as never, { userId: "m1", amount: -20, reason: "Chargeback", allowNegative: true }, 10),
        ).resolves.toBe(true);
        expect(current.state.balance).toBe(-10);
        expect(current.state.rows).toEqual([{ userId: "m1", amount: -20, type: "admin_remove", description: "Chargeback" }]);
    });

    it("leaves no deeper debt than the operator allowed when the member spends in between", async () => {
        // The operator read 10 and allowed -10. The member spent 8 before
        // the debit landed; taking 20 now would leave -18.
        current.state.balance = 2;
        await expect(
            adjustBalance(current.tx as never, { userId: "m1", amount: -20, reason: "Chargeback", allowNegative: true }, 10),
        ).resolves.toBe(false);
        expect(current.state.balance).toBe(2);
        expect(current.state.rows).toEqual([]);
    });

    it("still takes a debt that is no deeper than the one allowed", async () => {
        // Credits arrived in between: the debt is smaller than the one agreed.
        current.state.balance = 15;
        await expect(
            adjustBalance(current.tx as never, { userId: "m1", amount: -20, reason: "Chargeback", allowNegative: true }, 10),
        ).resolves.toBe(true);
        expect(current.state.balance).toBe(-5);
    });

    it("debits with a condition on the balance, never a bare decrement", async () => {
        await adjustBalance(current.tx as never, { userId: "m1", amount: -80, reason: "Chargeback", allowNegative: true }, 50);
        expect(current.tx.user.update).not.toHaveBeenCalled();
        expect(current.tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "m1", creditBalance: { gte: 50 } },
        }));
    });
});

describe("the endpoint", () => {
    it("asks who is signed in and whether they may change balances", async () => {
        session.user = undefined;
        expect((await post({ userId: "m1", amount: 5, reason: "x" })).status).toBe(401);

        session.user = { id: "admin-1" };
        hasPermission.mockResolvedValueOnce(false);
        expect((await post({ userId: "m1", amount: 5, reason: "x" })).status).toBe(403);
        expect(hasPermission).toHaveBeenLastCalledWith("admin-1", "credits.manage");
        expect(current.state.rows).toEqual([]);
    });

    it("refuses a removal past the balance and says which rule", async () => {
        const res = await post({ userId: "m1", amount: -80, reason: "Chargeback" });
        expect(res.status).toBe(409);
        await expect(res.json()).resolves.toMatchObject({ code: "credits_adjust_below_zero" });
        expect(current.state.balance).toBe(50);
    });

    it("says the balance moved when a debt was allowed and the member spent first", async () => {
        // The route reads 50; the member spends 45 before the debit.
        current.tx.user.findUnique.mockImplementationOnce(async () => {
            const read = { id: "m1", username: "Steve", creditBalance: current.state.balance };
            current.state.balance = 5;
            return read;
        });
        const res = await post({ userId: "m1", amount: -80, reason: "Chargeback", allowNegative: true });
        expect(res.status).toBe(409);
        await expect(res.json()).resolves.toMatchObject({ code: "credits_adjust_balance_moved" });
        expect(current.state.balance).toBe(5);
        expect(current.state.rows).toEqual([]);
    });

    it("refuses a change without a reason", async () => {
        const res = await post({ userId: "m1", amount: 5, reason: "  " });
        expect(res.status).toBe(400);
        await expect(res.json()).resolves.toMatchObject({ code: "credits_adjust_no_reason" });
    });

    it("makes the change, logs who made it and why, and answers with the new balance", async () => {
        const res = await post({ userId: "m1", amount: -20, reason: "Duplicate reward" });
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ balance: 30 });
        expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
            userId: "admin-1",
            action: "credits.balance.adjusted",
            entityId: "m1",
            metadata: expect.objectContaining({ amount: -20, reason: "Duplicate reward", belowZeroAllowed: false }),
        }));
        // A removal is told by the row in the member's history, not by a
        // notification that credits arrived.
        expect(doActionAsync).not.toHaveBeenCalled();
    });

    it("tells the member about credits they were given", async () => {
        await post({ userId: "m1", amount: 10, reason: "Event winner" });
        expect(doActionAsync).toHaveBeenCalledWith("credits.credit.added", expect.objectContaining({ userId: "m1", amount: 10 }));
    });
});
