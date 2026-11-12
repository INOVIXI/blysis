/**
 * Cashback paid on an order goes back when the order's money does.
 *
 * Cashback is paid on money that arrived. A refunded or charged-back order is
 * money that did not stay, and the credits it earned were spendable all the
 * same: buy, collect the cashback, charge the card back, spend the credits.
 * The wallet hears of the refund from the store and takes back what it paid,
 * as far as the balance still holds it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { awardLedgerId } from "@/modules/credits/lib/award";

const ledger = { findUnique: vi.fn(async (): Promise<{ amount: number } | null> => null), create: vi.fn(async () => ({})) };
const user = {
    findUnique: vi.fn(async (): Promise<{ creditBalance: number } | null> => ({ creditBalance: 0 })),
    updateMany: vi.fn(async () => ({ count: 1 })),
    update: vi.fn(async () => ({})),
};
const tx = { creditTransaction: ledger, user };

vi.mock("@/core/sdk/server", () => ({
    prisma: { ...tx, $transaction: async (work: (t: typeof tx) => Promise<unknown>) => work(tx) },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const onOrderRefunded = (await import("@/modules/credits/hooks/on-order-refunded")).default;

const order = { id: "order-1", userId: "member-1", orderNumber: "ORD-1" };

beforeEach(() => {
    vi.clearAllMocks();
});

describe("a refunded order's cashback", () => {
    it("is taken back", async () => {
        ledger.findUnique.mockResolvedValueOnce({ amount: 5 });
        user.findUnique.mockResolvedValueOnce({ creditBalance: 20 });

        await onOrderRefunded(order);

        expect(ledger.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: awardLedgerId("cashback", "order-1") } }),
        );
        expect(user.updateMany).toHaveBeenCalledWith({
            where: { id: "member-1", creditBalance: { gte: 5 } },
            data: { creditBalance: { decrement: 5 } },
        });
        expect(ledger.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ id: awardLedgerId("payment_refund", "order-1"), amount: -5, type: "payment_refund" }),
        });
    });

    it("is taken back only as far as the balance still holds it", async () => {
        ledger.findUnique.mockResolvedValueOnce({ amount: 5 });
        user.findUnique.mockResolvedValueOnce({ creditBalance: 3 });

        await onOrderRefunded(order);

        expect(user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { creditBalance: { decrement: 3 } } }));
    });

    it("takes nothing from an order that earned none", async () => {
        await onOrderRefunded(order);
        expect(user.updateMany).not.toHaveBeenCalled();
    });
});
