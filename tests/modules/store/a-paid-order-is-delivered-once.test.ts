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
 *
 * A shop, or one product, may hold a paid line in the chest instead. Then
 * payment runs nothing, the buyer's claim runs it once, and a refund takes
 * the row back without running anything.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const chestItems = fakeTable(() => ({ isRedeemed: false, giftState: null, createdAt: new Date() }));
const productCommands = fakeTable();
const orders = fakeTable();
const ownedProducts = fakeTable();
const products = fakeTable();
const orderItems = fakeTable();
const coupons = fakeTable();

const client = { chestItem: chestItems, productCommand: productCommands, order: orders, ownedProduct: ownedProducts, product: products, orderItem: orderItems, coupon: coupons };
const prismaMock = {
    ...client,
    user: { findUnique: vi.fn(async () => ({ creditBalance: 0 })) },
    $transaction: fakeTransaction(client, [chestItems.table, orders.table, ownedProducts.table]),
};

/** The store's settings as `moduleSettings("store")` answers them. */
let storeSettings: Record<string, unknown> = {};
vi.mock("@/core/sdk/server", () => ({
    prisma: prismaMock,
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    moduleSettings: vi.fn(async () => storeSettings),
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
const { activateGift, cancelGift, claimChestItem, PENDING } = await import("@/modules/store/lib/gifts");
const { takeBackOrder } = await import("@/modules/store/lib/take-back");
const { waitsInChest } = await import("@/modules/store/lib/delivery-mode");

const line = { id: "line-1", productId: "p1", name: "VIP", quantity: 1, metadata: null };
const buyer = { name: "Steve", id: "uuid-1", userId: "u1" };

beforeEach(() => {
    vi.clearAllMocks();
    refunds.length = 0;
    storeSettings = {};
    chestItems.table.rows = [];
    orders.table.rows = [];
    ownedProducts.table.rows = [];
    products.table.rows = [{ id: "p1", commandsPerUnit: false }];
    orderItems.table.rows = [];
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

    it("delivers nothing when the chest already took the line", async () => {
        chestItems.table.rows.push({ id: "c1", orderId: "o1", productId: "p1", userId: "u1", isRedeemed: true, giftState: null });

        await deliverPaidOrder({ id: "o1", items: [line] }, buyer);

        expect(deliverProduct).not.toHaveBeenCalled();
    });

    it("holds the row while its commands run, so the chest cannot take it then", async () => {
        chestItems.table.rows.push({ id: "c1", orderId: "o1", productId: "p1", userId: "u1", isRedeemed: false, giftState: null });
        let seen: unknown;
        deliverProduct.mockImplementation(async () => {
            seen = chestItems.table.rows[0].isRedeemed;
            return { success: true, results: ["Done"] };
        });

        await deliverPaidOrder({ id: "o1", items: [line] }, buyer);

        expect(seen).toBe(true);
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

describe("a paid order bought several times over", () => {
    const three = { ...line, quantity: 3 };

    it("asks for one run per unit when the product says so", async () => {
        products.table.rows = [{ id: "p1", commandsPerUnit: true }];

        await deliverPaidOrder({ id: "o1", orderNumber: "ORD-7", items: [three] }, buyer);

        expect(deliverProduct).toHaveBeenCalledTimes(1);
        expect(deliverProduct).toHaveBeenCalledWith(
            expect.objectContaining({ quantity: 3, perUnit: true, orderNumber: "ORD-7", lineNumber: 1 }),
        );
    });

    it("runs once per line when it does not", async () => {
        await deliverPaidOrder({ id: "o1", orderNumber: "ORD-7", items: [three] }, buyer);

        expect(deliverProduct).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3, perUnit: false }));
    });

    // The units are one delivery: a second pass over a paid order finds the
    // line taken and adds none.
    it("is not run again for the same payment", async () => {
        products.table.rows = [{ id: "p1", commandsPerUnit: true }];
        chestItems.table.rows.push({ id: "c1", orderId: "o1", productId: "p1", userId: "u1", isRedeemed: false, giftState: null });

        await deliverPaidOrder({ id: "o1", orderNumber: "ORD-7", items: [three] }, buyer);
        await deliverPaidOrder({ id: "o1", orderNumber: "ORD-7", items: [three] }, buyer);

        expect(deliverProduct).toHaveBeenCalledTimes(1);
    });

    // Lines are numbered by id, whichever order the caller listed them in.
    it("numbers a line by its place in the order", async () => {
        const first = { id: "line-0", productId: "p0", name: "Key", quantity: 1, metadata: null };
        productCommands.table.rows.push({ id: "cmd-0", productId: "p0", command: "key {player}", serverId: null, target: "server", whenOnline: true, order: 0 });

        await deliverPaidOrder({ id: "o1", orderNumber: "ORD-7", items: [line, first] }, buyer);

        expect(deliverProduct).toHaveBeenCalledWith(expect.objectContaining({ line: "line-0", lineNumber: 1 }));
        expect(deliverProduct).toHaveBeenCalledWith(expect.objectContaining({ line: "line-1", lineNumber: 2 }));
    });

    // A unit claimed from the chest after a delivery that stopped half way
    // carries the reference the first attempt used, so a plugin can refuse it.
    it("claimed from the chest, carries the order's number and the line's place", async () => {
        productCommands.table.rows = [{ id: "cmd-1", productId: "p1", command: "x {delivery}", serverId: null, target: "server", whenOnline: true, order: 0 }];
        products.table.rows = [{ id: "p1", commandsPerUnit: true }];
        orders.table.rows.push({ id: "o1", orderNumber: "ORD-7" });
        orderItems.table.rows.push({ id: "line-0", orderId: "o1", productId: "p0" }, { id: "line-1", orderId: "o1", productId: "p1" });
        chestItems.table.rows.push({ id: "c1", orderId: "o1", productId: "p1", productName: "VIP", quantity: 3, playerName: "Steve", variables: null, userId: "u1", isRedeemed: false, giftState: null });

        await expect(claimChestItem("u1", "c1", { name: null, id: null })).resolves.toEqual({ ok: true });

        expect(deliverProduct).toHaveBeenCalledWith(
            expect.objectContaining({ quantity: 3, perUnit: true, orderNumber: "ORD-7", lineNumber: 2 }),
        );
    });

    it("claimed from a chest row nobody bought, is named by the row", async () => {
        productCommands.table.rows = [{ id: "cmd-1", productId: "p1", command: "x {delivery}", serverId: null, target: "server", whenOnline: true, order: 0 }];
        chestItems.table.rows.push({ id: "c9", orderId: null, productId: "p1", productName: "VIP", quantity: 1, playerName: "Steve", variables: null, userId: "u1", isRedeemed: false, giftState: null });

        await claimChestItem("u1", "c9", { name: null, id: null });

        expect(deliverProduct).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: "c9", lineNumber: 1 }));
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

describe("a paid line held in the chest", () => {
    function paidRow() {
        chestItems.table.rows.push({ id: "c1", orderId: "o1", productId: "p1", productName: "VIP", quantity: 1, playerName: "Steve", variables: null, userId: "u1", isRedeemed: false, giftState: null });
    }

    it("runs no command at payment and stays in the chest", async () => {
        products.table.rows = [{ id: "p1", commandsPerUnit: false, deliveryMode: "hold" }];
        paidRow();

        await deliverPaidOrder({ id: "o1", items: [line] }, buyer);

        expect(deliverProduct).not.toHaveBeenCalled();
        expect(chestItems.table.rows[0]).toMatchObject({ isRedeemed: false });
    });

    it("is delivered now when there is no chest row to hold it in", async () => {
        products.table.rows = [{ id: "p1", commandsPerUnit: false, deliveryMode: "hold" }];

        await deliverPaidOrder({ id: "o1", items: [line] }, buyer);

        expect(deliverProduct).toHaveBeenCalledTimes(1);
    });

    it("is delivered once when claimed, and payment does not run it again after", async () => {
        products.table.rows = [{ id: "p1", commandsPerUnit: false, deliveryMode: "hold" }];
        paidRow();

        await deliverPaidOrder({ id: "o1", items: [line] }, buyer);
        await expect(claimChestItem("u1", "c1", { name: null, id: null })).resolves.toEqual({ ok: true });
        await expect(claimChestItem("u1", "c1", { name: null, id: null })).resolves.toEqual({ ok: false, code: "already_claimed" });
        await deliverPaidOrder({ id: "o1", items: [line] }, buyer);

        expect(deliverProduct).toHaveBeenCalledTimes(1);
        expect(deliverProduct).toHaveBeenCalledWith(expect.objectContaining({ playerName: "Steve", reference: { kind: "chest", id: "c1", label: "VIP" } }));
        expect(chestItems.table.rows[0]).toMatchObject({ isRedeemed: true });
    });

    it("claimed twice at once, is delivered once", async () => {
        products.table.rows = [{ id: "p1", commandsPerUnit: false, deliveryMode: "hold" }];
        paidRow();

        const answers = await Promise.all([
            claimChestItem("u1", "c1", { name: null, id: null }),
            claimChestItem("u1", "c1", { name: null, id: null }),
        ]);

        expect(answers.filter((a) => a.ok)).toHaveLength(1);
        expect(deliverProduct).toHaveBeenCalledTimes(1);
    });

    it("is taken back by a refund without a command being run", async () => {
        products.table.rows = [{ id: "p1", commandsPerUnit: false, deliveryMode: "hold", durationDays: null, grantsRoleId: null }];
        orders.table.rows.push({ id: "o1", orderNumber: "ORD-1", userId: "u1", status: "COMPLETED", metadata: {} });
        paidRow();
        await deliverPaidOrder({ id: "o1", items: [line] }, buyer);

        await takeBackOrder(prismaMock as never, { id: "o1", metadata: {} });

        expect(chestItems.table.rows).toEqual([]);
        expect(deliverProduct).not.toHaveBeenCalled();
        // Nothing reached the game, so nothing is listed as kept there.
        expect(orders.table.rows[0].metadata).toEqual({});
        await expect(claimChestItem("u1", "c1", { name: null, id: null })).resolves.toEqual({ ok: false, code: "not_found" });
    });

    it("follows the shop when the product inherits, and the product when it says otherwise", async () => {
        storeSettings = { holdPurchasesInChest: true };
        products.table.rows = [{ id: "p1", commandsPerUnit: false, deliveryMode: "inherit" }];
        paidRow();
        await deliverPaidOrder({ id: "o1", items: [line] }, buyer);
        expect(deliverProduct).not.toHaveBeenCalled();

        products.table.rows = [{ id: "p1", commandsPerUnit: false, deliveryMode: "now" }];
        await deliverPaidOrder({ id: "o1", items: [line] }, buyer);
        expect(deliverProduct).toHaveBeenCalledTimes(1);
        expect(chestItems.table.rows[0]).toMatchObject({ isRedeemed: true });
    });

    it("holds only the lines whose product holds", async () => {
        const key = { id: "line-0", productId: "p0", name: "Key", quantity: 1, metadata: null };
        products.table.rows = [
            { id: "p1", commandsPerUnit: false, deliveryMode: "hold" },
            { id: "p0", commandsPerUnit: false, deliveryMode: "inherit" },
        ];
        productCommands.table.rows.push({ id: "cmd-0", productId: "p0", command: "key {player}", serverId: null, target: "server", whenOnline: true, order: 0 });
        paidRow();
        chestItems.table.rows.push({ id: "c0", orderId: "o1", productId: "p0", userId: "u1", isRedeemed: false, giftState: null });

        await deliverPaidOrder({ id: "o1", items: [line, key] }, buyer);

        expect(deliverProduct).toHaveBeenCalledTimes(1);
        expect(deliverProduct).toHaveBeenCalledWith(expect.objectContaining({ line: "line-0" }));
        expect(chestItems.table.rows.find((row) => row.id === "c1")).toMatchObject({ isRedeemed: false });
        expect(chestItems.table.rows.find((row) => row.id === "c0")).toMatchObject({ isRedeemed: true });
    });

    // A gift never reaches payment-time delivery: it waits for its recipient
    // whatever the shop holds, and is claimed by them like any other row.
    it("leaves a gift as it was: accepted by its recipient, then claimed once", async () => {
        storeSettings = { holdPurchasesInChest: true };
        products.table.rows = [{ id: "p1", commandsPerUnit: false, deliveryMode: "now" }];
        orders.table.rows.push({ id: "o1", orderNumber: "ORD-1", userId: "u1", total: 50, status: "COMPLETED", metadata: { gift: true }, items: [] });
        chestItems.table.rows.push({ id: "c1", orderId: "o1", productId: "p1", productName: "VIP", quantity: 1, playerName: null, variables: null, userId: "u2", giftedById: "u1", giftedToId: "u2", isRedeemed: false, giftState: PENDING });

        await expect(claimChestItem("u2", "c1", { name: "Alex", id: null })).resolves.toEqual({ ok: false, code: "not_pending" });
        await expect(activateGift("u2", "c1")).resolves.toEqual({ ok: true });
        await expect(claimChestItem("u2", "c1", { name: "Alex", id: null })).resolves.toEqual({ ok: true });

        expect(deliverProduct).toHaveBeenCalledTimes(1);
        expect(deliverProduct).toHaveBeenCalledWith(expect.objectContaining({ playerName: "Alex", userId: "u2" }));
        expect(refunds).toEqual([]);
    });
});

describe("which way a product delivers", () => {
    it("is the product's own answer first, then the shop's", () => {
        expect(waitsInChest("hold", false)).toBe(true);
        expect(waitsInChest("now", true)).toBe(false);
        expect(waitsInChest("inherit", true)).toBe(true);
        expect(waitsInChest("inherit", false)).toBe(false);
        // A value nothing wrote is the shop's, not a guess.
        expect(waitsInChest(null, true)).toBe(true);
        expect(waitsInChest("later", false)).toBe(false);
    });
});
