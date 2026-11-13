// @vitest-environment node
/**
 * A spin whose prize cannot be handed over takes nothing and leaves nothing.
 *
 * A prize of kind `product` asks its owner through `product.grant`, and a
 * refusal was meant to undo the turn. The route answered 409 but returned
 * from its transaction instead of throwing out of it, so the transaction
 * committed: the member paid for the turn, the spin row stayed and the
 * cooldown counted from it, for a prize nobody received.
 *
 * The database here is the in-memory one game-connect tests use, whose
 * transaction puts every table back when its callback throws, as Postgres
 * does. The wallet answers `credit.change` on that same transaction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const users = fakeTable();
const wheelSpins = fakeTable(() => ({ createdAt: new Date() }));
const state = { granted: false };

const WHEEL = {
    id: "w1",
    slug: "daily",
    name: "Daily wheel",
    cooldown: "daily",
    cooldownHours: 24,
    cost: 5,
    roleIds: [] as string[],
    isActive: true,
    prizes: [{ id: "p1", name: "Legendary key", type: "product", productId: "key", value: 1, probability: 1, color: "#fff", isActive: true }],
};

const db = {
    wheel: { findFirst: vi.fn(async () => WHEEL) },
    user: users,
    wheelSpin: wheelSpins,
    activityFeedItem: { create: vi.fn(async () => ({})) },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(),
};
db.$transaction = fakeTransaction(db, [users.table, wheelSpins.table]);

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    // No translations are seeded here: each record reads as written.
    translateContent: async (_db: unknown, _kind: unknown, rows: unknown[]) => rows,
    rateLimitForRoleAsync: vi.fn(async () => true),
}));
vi.mock("@/core/sdk/auth", () => ({
    auth: vi.fn(async () => ({ user: { id: "u1", role: "member" } })),
}));
vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async (hook: string, value: unknown, args: { tx: typeof db; userId: string; amount?: number }) => {
        if (hook === "credit.change") {
            const user = await args.tx.user.findUnique({ where: { id: args.userId } });
            const balance = Number(user?.creditBalance ?? 0) + (args.amount ?? 0);
            if (balance < 0) return { applied: false };
            await args.tx.user.update({ where: { id: args.userId }, data: { creditBalance: balance } });
            return { applied: true };
        }
        if (hook === "product.grant") return { granted: state.granted };
        return value;
    }),
    doActionAsync: vi.fn(async () => undefined),
}));

const { POST } = await import("@/modules/wheel/api/spin/route");

function spin() {
    return POST(new Request("http://localhost/api/v1/wheel/spin?wheel=daily") as never);
}

function balance() {
    return users.table.rows.find((u) => u.id === "u1")?.creditBalance;
}

beforeEach(() => {
    vi.clearAllMocks();
    users.table.rows = [{ id: "u1", creditBalance: 100, roleId: null }];
    wheelSpins.table.rows = [];
    state.granted = false;
});

describe("a spin whose prize is refused", () => {
    it("is answered as a prize that cannot be handed over", async () => {
        const answer = await spin();

        expect(answer.status).toBe(409);
        expect(((await answer.json()) as { code?: string }).code).toBe("wheel_prize_unavailable");
    });

    it("takes no credits for the turn", async () => {
        await spin();

        expect(balance()).toBe(100);
    });

    it("leaves no spin, so the cooldown does not start", async () => {
        await spin();
        expect(wheelSpins.table.rows).toHaveLength(0);

        state.granted = true;
        const again = await spin();

        expect(again.status).toBe(200);
    });
});

describe("a spin whose prize is handed over", () => {
    it("still pays for the turn and records it", async () => {
        state.granted = true;

        const answer = await spin();

        expect(answer.status).toBe(200);
        expect(balance()).toBe(95);
        expect(wheelSpins.table.rows).toHaveLength(1);
    });
});
