// @vitest-environment node
/**
 * A paid line is delivered once: by its commands, or from the chest, never
 * both.
 *
 * Every paid line also gets a chest row. A line whose commands ran at payment
 * used to keep that row unredeemed, so its buyer could claim the same goods a
 * second time. The row is closed now when delivery took the line, and only
 * then: a line nothing could deliver stays in the chest, which is what the
 * chest is for. A gift waiting for its recipient is not the buyer's to close.
 *
 * A gift that waits can be accepted or taken back, and two people doing both
 * at once must leave exactly one of them standing, with the money moved once.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const chestItems = fakeTable(() => ({ isRedeemed: false, giftState: null, createdAt: new Date() }));
const productCommands = fakeTable();
const orders = fakeTable();
const ownedProducts = fakeTable();

const client = { chestItem: chestItems, productCommand: productCommands, order: orders, ownedProduct: ownedProducts };
const prismaMock = {
    ...client,
    user: { findUnique: vi.fn(async () => ({ creditBalance: 0 })) },
    $transaction: fakeTransaction(client, [chestItems.table, orders.table, ownedProducts.table]),
};

vi.mock("@/core/sdk/server", () => ({
    prisma: prismaMock,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    moduleSettings: vi.fn(async () => ({})),
}));

const refunds: { userId: string; amount: number }[] = [];
vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async (hook: string, value: unknown, context: Record<string, unknown>) => {
        if (hook !== "credit.change") return value;
        refunds.push({ userId: context.userId as string, amount: context.amount as number });
        return { applied: true };
    }),
    generateOrderNumber: () => "ORD-1",
}));

vi.mock("@/modules/store/lib/stock", () => ({
    claimStock: vi.fn(async () => undefined),
    releaseStock: vi.fn(async () => undefined),
    stockClaims: () => [],
}));
vi.mock("@/modules/store/lib/popularity", () => ({
    countSales: vi.fn(async () => undefined),
    uncountSales: vi.fn(async () => undefined),
}));

const deliverProduct = vi.fn(async () => ({ success: true, results: ["Done"] }));
vi.mock("@/modules/store/lib/delivery", () => ({ deliverProduct }));

const { deliverPaidOrder } = await import("@/modules/store/lib/credit-order");
const { activateGift, cancelGift, PENDING } = await import("@/modules/store/lib/gifts");

const line = { id: "line-1", productId: "p1", name: "VIP", quantity: 1, metadata: null };
const buyer = { name: "Steve", id: "uuid-1", userId: "u1" };

beforeEach(() => {
    vi.clearAllMocks();
    refunds.length = 0;
    chestItems.table.rows = [];
    orders.table.rows = [];
    ownedProducts.table.rows = [];
    productCommands.table.rows = [{ id: "cmd-1", productId: "p1", command: "lp user {player} parent add vip", serverId: null, target: "server", whenOnline: true, order: 0 }];
    deliverProduct.mockResolvedValue({ success: true, results: ["Done"] });
});

describe("a paid order", () => {
    it("closes the chest row of a line its commands delivered", async () => {
        chestItems.table.rows.push({ id: "c1", orderId: "o1", productId: "p1", userId: "u1", isRedeemed: false, giftState: null });

        await deliverPaidOrder({ id: "o1", items: [line] }, buyer);

        expect(deliverProduct).toHaveBeenCalledTimes(1);
        expect(chestItems.table.rows[0]).toMatchObject({ isRedeemed: true });
    });

    it("leaves the row claimable when nothing could deliver the line", async () => {
        deliverProduct.mockResolvedValue({ success: false, results: ["Error: no installed module can reach a game server"] });
        chestItems.table.rows.push({ id: "c1", orderId: "o1", productId: "p1", userId: "u1", isRedeemed: false, giftState: null });

        await deliverPaidOrder({ id: "o1", items: [line] }, buyer);

        expect(chestItems.table.rows[0]).toMatchObject({ isRedeemed: false });
    });

    it("does not close a gift that waits for its recipient", async () => {
        chestItems.table.rows.push({ id: "c1", orderId: "o1", productId: "p1", userId: "u2", isRedeemed: false, giftState: PENDING });

        await deliverPaidOrder({ id: "o1", items: [line] }, buyer);

        expect(chestItems.table.rows[0]).toMatchObject({ isRedeemed: false, giftState: PENDING });
    });

    it("hands each line to delivery with the order as its reference", async () => {
        await deliverPaidOrder({ id: "o1", items: [line] }, buyer);

        expect(deliverProduct).toHaveBeenCalledWith(
            expect.objectContaining({
                playerName: "Steve",
                playerId: "uuid-1",
                userId: "u1",
                reference: { kind: "order", id: "o1", label: "VIP" },
                line: "line-1",
            }),
        );
    });
});

describe("a gift that waits", () => {
    function boughtAsGift() {
        orders.table.rows.push({ id: "o1", orderNumber: "ORD-1", userId: "u1", total: 50, status: "COMPLETED", metadata: { gift: true }, items: [] });
        chestItems.table.rows.push({ id: "c1", orderId: "o1", productId: "p1", userId: "u2", giftedById: "u1", giftedToId: "u2", isRedeemed: false, giftState: PENDING });
    }

    it("once accepted, cannot be taken back", async () => {
        boughtAsGift();

        await expect(activateGift("u2", "c1")).resolves.toEqual({ ok: true });
        await expect(cancelGift("u1", "c1")).resolves.toEqual({ ok: false, code: "not_pending" });
        expect(refunds).toEqual([]);
    });

    it("once taken back, cannot be accepted, and refunds its price once", async () => {
        boughtAsGift();

        await expect(cancelGift("u1", "c1")).resolves.toMatchObject({ ok: true, refunded: 50 });
        await expect(activateGift("u2", "c1")).resolves.toEqual({ ok: false, code: "not_found" });
        await expect(cancelGift("u1", "c1")).resolves.toEqual({ ok: false, code: "not_found" });
        expect(refunds).toEqual([{ userId: "u1", amount: 50 }]);
        expect(orders.table.rows[0]).toMatchObject({ status: "REFUNDED" });
    });

    it("accepted and taken back at once leaves one of them standing", async () => {
        boughtAsGift();

        const [accepted, taken] = await Promise.all([activateGift("u2", "c1"), cancelGift("u1", "c1")]);

        expect([accepted.ok, taken.ok].filter(Boolean)).toHaveLength(1);
        expect(refunds.length).toBe(taken.ok ? 1 : 0);
    });

    it("handed over from the sender's chest goes back to the sender, with no money moved", async () => {
        chestItems.table.rows.push({ id: "c1", orderId: null, productId: "p1", userId: "u2", giftedById: "u1", giftedToId: "u2", isRedeemed: false, giftState: PENDING });

        await expect(cancelGift("u1", "c1")).resolves.toMatchObject({ ok: true, refunded: 0 });
        expect(chestItems.table.rows[0]).toMatchObject({ userId: "u1", giftState: null, giftedById: null });
        expect(refunds).toEqual([]);
    });
});
