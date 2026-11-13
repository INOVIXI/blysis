// @vitest-environment node
/**
 * An unpaid checkout is reminded about once, and only when the operator and
 * the buyer both want it.
 *
 * The rules live in `lib/checkout-reminder.ts`. These run them against an
 * in-memory table that claims a row the way Postgres does: an update with
 * `remindedAt: null` in its condition touches the row only while it is
 * still null.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActionPayload } from "@/core/sdk";

const shouldNotify = vi.fn(async (..._args: unknown[]) => true);
const queueEmail = vi.fn(async (..._args: unknown[]) => "job-1");
const findUser = vi.fn(async (..._args: unknown[]): Promise<{ email: string; locale: string } | null> => ({ email: "alice@example.com", locale: "tr" }));
vi.mock("@/core/sdk/server", () => ({
    prisma: { user: { findUnique: (...args: unknown[]) => findUser(...args) } },
    shouldNotify: (...args: unknown[]) => shouldNotify(...args),
    queueEmail: (...args: unknown[]) => queueEmail(...args),
    formatSiteCurrency: async (amount: number) => `${amount.toFixed(2)} USD`,
    resolveAppUrl: () => "https://shop.example",
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { reminderWindow, sendCheckoutReminders } = await import("@/modules/store/lib/checkout-reminder");
const { restoreCartFromOrder } = await import("@/modules/store/lib/cart-restore");
const { default: onCheckoutReminder } = await import("@/modules/store/hooks/on-checkout-reminder");
type ReminderDb = import("@/modules/store/lib/checkout-reminder").ReminderDb;
type RestoreDb = import("@/modules/store/lib/cart-restore").RestoreDb;
type Reminder = ActionPayload<"store.checkout.reminder">;

const NOW = new Date("2026-11-12T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

interface Row {
    id: string;
    userId: string | null;
    status: string;
    createdAt: Date;
    remindedAt: Date | null;
    orderNumber?: string;
    total?: number;
    amount?: number;
}

function table(rows: Row[]) {
    return {
        rows,
        findMany: vi.fn(async ({ where, take }: { where: { createdAt: { gte: Date; lte: Date } }; take: number }) =>
            rows
                .filter((row) =>
                    row.status === "PENDING" &&
                    row.remindedAt === null &&
                    row.userId !== null &&
                    row.createdAt >= where.createdAt.gte &&
                    row.createdAt <= where.createdAt.lte,
                )
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .slice(0, take)
                .map((row) => ({ ...row })),
        ),
        // Read and write with no await between them: one statement, as the
        // database runs a conditional update.
        updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string; remindedAt: null }; data: { remindedAt: Date } }) => {
            const row = rows.find((r) => r.id === where.id && r.status === where.status && r.remindedAt === null);
            if (!row) return { count: 0 };
            row.remindedAt = data.remindedAt;
            return { count: 1 };
        }),
        count: vi.fn(async ({ where }: { where: { userId: string; status: { in: string[] }; createdAt: { gt: Date } } }) =>
            rows.filter((r) => r.userId === where.userId && where.status.in.includes(r.status) && r.createdAt > where.createdAt.gt).length,
        ),
    };
}

function shop(orders: Row[], topUps: Row[] = []) {
    const order = table(orders);
    const creditTopUp = table(topUps);
    return { db: { order, creditTopUp } as unknown as ReminderDb, order, creditTopUp };
}

const ON = { checkoutReminderEnabled: true, checkoutReminderHours: 2 };

function sweep(db: ReminderDb, overrides: Partial<Parameters<typeof sendCheckoutReminders>[0]> = {}) {
    const sent: Reminder[] = [];
    const run = sendCheckoutReminders({
        db,
        settings: ON,
        announce: async (reminder) => {
            sent.push(reminder);
        },
        now: NOW,
        ...overrides,
    });
    return { sent, run };
}

const pendingOrder = (id: string, userId: string, age: number): Row => ({
    id, userId, status: "PENDING", createdAt: hoursAgo(age), remindedAt: null, orderNumber: `ORD-${id}`, total: 19.99,
});

describe("an unpaid checkout is reminded once", () => {
    it("sends nothing while the operator has not switched it on", async () => {
        const { db, order } = shop([pendingOrder("o1", "alice", 5)]);
        const { sent, run } = sweep(db, { settings: { ...ON, checkoutReminderEnabled: false } });
        expect(await run).toBe(0);
        expect(sent).toEqual([]);
        expect(order.findMany).not.toHaveBeenCalled();
    });

    it("reminds an order left unpaid past the wait, with a link that fills the basket again", async () => {
        const { db, order } = shop([pendingOrder("o1", "alice", 5)]);
        const { sent, run } = sweep(db);
        expect(await run).toBe(1);
        expect(sent).toEqual([{
            userId: "alice",
            kind: "order",
            id: "o1",
            orderNumber: "ORD-o1",
            total: 19.99,
            resumePath: "/store/cart?restore=o1",
        }]);
        expect(order.rows[0].remindedAt).toEqual(NOW);
    });

    it("never reminds the same checkout twice, however many sweeps run", async () => {
        const { db } = shop([pendingOrder("o1", "alice", 5)]);
        const first = sweep(db);
        const second = sweep(db);
        const third = sweep(db);
        await Promise.all([first.run, second.run, third.run]);
        expect(first.sent.length + second.sent.length + third.sent.length).toBe(1);

        const later = sweep(db, { now: new Date(NOW.getTime() + 86_400_000) });
        expect(await later.run).toBe(0);
    });

    it("waits for the set hours, and leaves checkouts older than the look-back alone", async () => {
        const { db, order } = shop([
            pendingOrder("young", "alice", 1),
            pendingOrder("ancient", "bob", 2 + 24 * 4),
        ]);
        const { sent, run } = sweep(db);
        expect(await run).toBe(0);
        expect(sent).toEqual([]);
        expect(order.rows.every((row) => row.remindedAt === null)).toBe(true);
    });

    it("says nothing to a buyer who has paid since, and does not come back to it", async () => {
        const { db, order } = shop([
            pendingOrder("o1", "alice", 5),
            { id: "paid", userId: "alice", status: "COMPLETED", createdAt: hoursAgo(4), remindedAt: null },
        ]);
        const { sent, run } = sweep(db);
        expect(await run).toBe(0);
        expect(sent).toEqual([]);
        expect(order.rows[0].remindedAt).toEqual(NOW);
    });

    it("writes once to a buyer who tried several times, about the newest attempt", async () => {
        const { db, order } = shop(
            [pendingOrder("old", "alice", 30), pendingOrder("new", "alice", 3)],
            [{ id: "t1", userId: "alice", status: "PENDING", createdAt: hoursAgo(10), remindedAt: null, amount: 5 }],
        );
        const { sent, run } = sweep(db);
        expect(await run).toBe(1);
        expect(sent.map((m) => m.resumePath)).toEqual(["/store/cart?restore=new"]);
        expect(order.rows.every((row) => row.remindedAt !== null)).toBe(true);
    });

    it("waits for a newer attempt still inside the wait rather than writing about the older one", async () => {
        const { db, order } = shop([pendingOrder("old", "alice", 5), pendingOrder("new", "alice", 1)]);
        const { sent, run } = sweep(db);
        expect(await run).toBe(0);
        expect(sent).toEqual([]);

        const later = sweep(db, { now: new Date(NOW.getTime() + 2 * 3_600_000) });
        expect(await later.run).toBe(1);
        expect(later.sent.map((m) => m.id)).toEqual(["new"]);
        expect(order.rows.every((row) => row.remindedAt !== null)).toBe(true);
    });

    it("reminds a credit top-up, leading to where credits are bought", async () => {
        const { db, creditTopUp } = shop([], [
            { id: "t1", userId: "bob", status: "PENDING", createdAt: hoursAgo(3), remindedAt: null, amount: 9.99 },
        ]);
        const { sent, run } = sweep(db);
        expect(await run).toBe(1);
        expect(sent[0]).toMatchObject({ userId: "bob", kind: "topUp", id: "t1", orderNumber: null, total: 9.99, resumePath: "/profile?section=credits" });
        expect(creditTopUp.rows[0].remindedAt).toEqual(NOW);
    });

    it("leaves a paid or cancelled checkout alone", async () => {
        const { db } = shop([
            { ...pendingOrder("o1", "alice", 5), status: "COMPLETED" },
            { ...pendingOrder("o2", "bob", 5), status: "CANCELLED" },
        ]);
        const { run } = sweep(db);
        expect(await run).toBe(0);
    });

    it("measures the window from now", () => {
        const { from, until } = reminderWindow(NOW, 2);
        expect(until).toEqual(hoursAgo(2));
        expect(from).toEqual(hoursAgo(2 + 72));
    });
});

describe("the store's own reminder email", () => {
    const reminder: Reminder = {
        userId: "alice",
        kind: "order",
        id: "o1",
        orderNumber: "ORD-o1",
        total: 19.99,
        resumePath: "/store/cart?restore=o1",
    };

    beforeEach(() => {
        shouldNotify.mockClear();
        queueEmail.mockClear();
        findUser.mockClear();
    });

    it("says nothing to a buyer who switched the reminder off", async () => {
        shouldNotify.mockResolvedValueOnce(false);
        await onCheckoutReminder(reminder);
        expect(shouldNotify).toHaveBeenCalledWith("alice", "store.checkout.reminder", "email");
        expect(queueEmail).not.toHaveBeenCalled();
    });

    it("writes in the buyer's language, with the way back and the way out", async () => {
        await onCheckoutReminder(reminder);
        expect(queueEmail).toHaveBeenCalledTimes(1);
        const mail = queueEmail.mock.calls[0][0] as { to: string; subject: string; html: string; body: string };
        expect(mail.to).toBe("alice@example.com");
        expect(mail.subject).toBe("Satın alman henüz tamamlanmadı");
        expect(mail.html).toContain("https://shop.example/store/cart?restore=o1");
        expect(mail.html).toContain("https://shop.example/profile?section=notifications");
        expect(mail.body).toContain("ORD-o1");
    });

    it("sends nothing to an account that is gone", async () => {
        findUser.mockResolvedValueOnce(null);
        await onCheckoutReminder(reminder);
        expect(queueEmail).not.toHaveBeenCalled();
    });
});

describe("the reminder's link fills the basket again", () => {
    function cart(order: { userId: string; status: string; items: { productId: string | null; quantity: number }[] } | null, active: string[], inCart: string[] = []) {
        const lines = new Map(inCart.map((id) => [id, 1]));
        const db = {
            order: {
                findFirst: vi.fn(async ({ where }: { where: { userId: string; status: string } }) =>
                    order && order.userId === where.userId && order.status === where.status ? { items: order.items } : null,
                ),
            },
            product: {
                findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
                    where.id.in.filter((id) => active.includes(id)).map((id) => ({ id })),
                ),
            },
            cartItem: {
                findMany: vi.fn(async () => [...lines.keys()].map((productId) => ({ productId }))),
                upsert: vi.fn(async ({ create }: { create: { productId: string; quantity: number } }) => {
                    lines.set(create.productId, create.quantity);
                }),
            },
        };
        return { db: db as unknown as RestoreDb, lines };
    }

    it("puts the buyer's own unpaid order back, leaving out what is no longer sold", async () => {
        const { db, lines } = cart(
            { userId: "alice", status: "PENDING", items: [{ productId: "rank", quantity: 1 }, { productId: "keys", quantity: 3 }, { productId: "gone", quantity: 1 }] },
            ["rank", "keys"],
        );
        expect(await restoreCartFromOrder(db, "alice", "o1", 10)).toBe(2);
        expect(Object.fromEntries(lines)).toEqual({ rank: 1, keys: 3 });
    });

    it("finds nothing in somebody else's order or a paid one", async () => {
        const mine = { userId: "alice", status: "PENDING", items: [{ productId: "rank", quantity: 1 }] };
        expect(await restoreCartFromOrder(cart(mine, ["rank"]).db, "bob", "o1", 10)).toBeNull();
        expect(await restoreCartFromOrder(cart({ ...mine, status: "COMPLETED" }, ["rank"]).db, "alice", "o1", 10)).toBeNull();
    });

    it("keeps to the basket's line cap", async () => {
        const { db, lines } = cart(
            { userId: "alice", status: "PENDING", items: [{ productId: "a", quantity: 1 }, { productId: "b", quantity: 1 }] },
            ["a", "b"],
            ["held"],
        );
        expect(await restoreCartFromOrder(db, "alice", "o1", 2)).toBe(1);
        expect(lines.size).toBe(2);
    });
});
