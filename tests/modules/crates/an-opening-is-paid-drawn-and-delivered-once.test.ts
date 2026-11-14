// @vitest-environment node
/**
 * An opening is paid for, drawn and delivered once, or not at all.
 *
 * Four ways to get more out of a crate than was paid for, each the shape a
 * real double delivery takes: twenty requests sent together all read "under
 * the limit" from the snapshot before the transaction; a member holding one
 * key sends two requests and both read "one key"; a reward the store refuses
 * to hand over after the key or the credits were already taken; and one
 * opening delivering its reward twice.
 *
 * The fake database below does what the real one does where it matters: an
 * advisory lock is held per key until the transaction ends, a key is spent by
 * a conditional decrement, and a transaction that throws undoes every write it
 * made. Every request reads its snapshot before any of them writes, which is
 * the interleaving that breaks a check made outside the lock.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Opening { userId: string; crateId: string; rewardId: string; createdAt: Date }

const state = {
    balance: 0,
    keys: 0,
    openings: [] as Opening[],
    chest: [] as { userId: string; productId: string; quantity: number }[],
    creditMoves: [] as number[],
    refuseGrant: false,
    early: 0,
    expected: 1,
    release: null as null | (() => void),
    gate: Promise.resolve() as Promise<void>,
};
const locks = new Map<string, Promise<void>>();

function crateRow(overrides: Record<string, unknown> = {}) {
    return {
        id: "c1",
        name: "Daily crate",
        cost: 100,
        keyProductId: "key-product",
        perPersonLimit: 0,
        perPersonPeriod: "day",
        roleIds: [] as string[],
        isActive: true,
        rewards: [{ id: "r1", name: "A sword", kind: "product", productId: "sword", value: 1, weight: 1, rarity: "rare" }],
        ...overrides,
    };
}
let crate = crateRow();

/** Writes made inside one transaction, undone in reverse if it throws. */
type Undo = () => void;

function makeTx(held: Array<() => void>, journal: Undo[]) {
    return {
        journal,
        $executeRaw: vi.fn(async (_parts: TemplateStringsArray, key: string) => {
            while (locks.has(key)) await locks.get(key);
            let free!: () => void;
            locks.set(key, new Promise<void>((resolve) => (free = resolve)));
            held.push(() => { locks.delete(key); free(); });
            return 1;
        }),
        crateOpening: {
            count: vi.fn(async () => state.openings.length),
            create: vi.fn(async (args: { data: { userId: string; crateId: string; rewardId: string } }) => {
                // A real insert takes a moment; without it every write lands
                // in one tick and hides the interleaving.
                await new Promise((resolve) => setTimeout(resolve, 1));
                const row = { ...args.data, createdAt: new Date() };
                state.openings.push(row);
                journal.push(() => { state.openings.splice(state.openings.indexOf(row), 1); });
                return { id: `o${state.openings.length}` };
            }),
        },
        crateKey: {
            updateMany: vi.fn(async (args: { where: { count: { gte: number } } }) => {
                await new Promise((resolve) => setTimeout(resolve, 1));
                if (state.keys < args.where.count.gte) return { count: 0 };
                state.keys -= 1;
                journal.push(() => { state.keys += 1; });
                return { count: 1 };
            }),
        },
    };
}
type FakeTx = ReturnType<typeof makeTx>;

const db = {
    crateBox: { findUnique: vi.fn(async () => crate) },
    user: { findUnique: vi.fn(async () => ({ creditBalance: state.balance, roleId: null })) },
    crateKey: { findUnique: vi.fn(async () => ({ count: state.keys })) },
    crateOpening: {
        // Held until every request has asked, so all of them see the same
        // snapshot before any of them writes.
        count: vi.fn(async () => {
            const seen = state.openings.length;
            state.early += 1;
            if (state.early >= state.expected) state.release?.();
            await state.gate;
            return seen;
        }),
    },
    activityFeedItem: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (work: (tx: FakeTx) => Promise<unknown>) => {
        const held: Array<() => void> = [];
        const journal: Undo[] = [];
        try {
            return await work(makeTx(held, journal));
        } catch (error) {
            for (const undo of journal.reverse()) undo();
            throw error;
        } finally {
            for (const release of held) release();
        }
    }),
};

vi.mock("@/core/sdk/server", () => ({
    prisma: db,
    rateLimitForRoleAsync: vi.fn(async () => true),
}));
vi.mock("@/core/sdk/auth", () => ({
    auth: vi.fn(async () => ({ user: { id: "u1", role: "member" } })),
}));
vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: vi.fn(async (hook: string, value: unknown, args: { tx: FakeTx; amount?: number; userId?: string; productId?: string; quantity?: number }) => {
        if (hook === "credit.change") {
            const amount = args.amount ?? 0;
            if (amount < 0 && state.balance + amount < 0) return { applied: false };
            state.balance += amount;
            state.creditMoves.push(amount);
            args.tx.journal.push(() => { state.balance -= amount; state.creditMoves.pop(); });
            return { applied: true };
        }
        if (hook === "product.grant") {
            if (state.refuseGrant) return { granted: false };
            const row = { userId: args.userId!, productId: args.productId!, quantity: args.quantity ?? 1 };
            state.chest.push(row);
            args.tx.journal.push(() => { state.chest.splice(state.chest.indexOf(row), 1); });
            return { granted: true, name: "A sword" };
        }
        return value;
    }),
    doActionAsync: vi.fn(async () => undefined),
}));

const { POST } = await import("@/modules/crates/api/open/route");

function open(pay?: "key" | "credits") {
    return POST(new Request(`http://localhost/api/v1/crates/open?crate=daily${pay ? `&pay=${pay}` : ""}`, { method: "POST" }) as never);
}

async function sendTogether(count: number, pay?: "key" | "credits") {
    state.expected = count;
    state.early = 0;
    state.gate = new Promise<void>((resolve) => (state.release = resolve));
    const answers = await Promise.all(Array.from({ length: count }, () => open(pay)));
    return Promise.all(answers.map(async (r) => ({ status: r.status, body: (await r.json()) as { code?: string } })));
}

beforeEach(() => {
    vi.clearAllMocks();
    locks.clear();
    Object.assign(state, {
        balance: 0, keys: 0, openings: [], chest: [], creditMoves: [], refuseGrant: false,
        early: 0, expected: 1, release: null, gate: Promise.resolve(),
    });
    crate = crateRow();
});

describe("a per-person limit", () => {
    it("holds when the requests arrive together", async () => {
        crate = crateRow({ perPersonLimit: 1 });
        state.balance = 10_000;

        const answers = await sendTogether(20, "credits");

        expect(answers.filter((a) => a.status === 200)).toHaveLength(1);
        expect(state.openings).toHaveLength(1);
        expect(state.chest).toHaveLength(1);
        // Paid once: the refused requests were turned away inside the lock,
        // before anything was taken.
        expect(state.creditMoves).toEqual([-100]);
        expect(state.balance).toBe(9_900);
        for (const refused of answers.filter((a) => a.status !== 200)) {
            expect(refused.status).toBe(429);
            expect(refused.body.code).toBe("crate_limit_reached");
        }
    });
});

describe("a key", () => {
    it("opens one crate however many requests spend it together", async () => {
        state.keys = 1;
        state.gate = Promise.resolve();

        const answers = await Promise.all(Array.from({ length: 10 }, () => open("key")));
        const statuses = answers.map((a) => a.status);

        expect(statuses.filter((s) => s === 200)).toHaveLength(1);
        expect(state.keys).toBe(0);
        expect(state.openings).toHaveLength(1);
        expect(state.chest).toHaveLength(1);
    });

    it("is spent before credits when the member names no payment", async () => {
        state.keys = 2;
        state.balance = 1_000;

        const answer = await open();

        expect(answer.status).toBe(200);
        expect(state.keys).toBe(1);
        expect(state.balance).toBe(1_000);
    });
});

describe("a reward the store will not hand over", () => {
    it("takes no key and records no opening", async () => {
        state.keys = 1;
        state.refuseGrant = true;

        const answer = await open("key");

        expect(answer.status).toBe(409);
        expect(((await answer.json()) as { code: string }).code).toBe("crate_reward_unavailable");
        expect(state.keys).toBe(1);
        expect(state.openings).toHaveLength(0);
        expect(state.chest).toHaveLength(0);
    });

    it("takes no credits either", async () => {
        state.balance = 500;
        state.refuseGrant = true;

        const answer = await open("credits");

        expect(answer.status).toBe(409);
        expect(state.balance).toBe(500);
        expect(state.creditMoves).toEqual([]);
        expect(state.openings).toHaveLength(0);
    });
});

describe("one opening", () => {
    it("delivers its reward once, into the chest, on the opening's own transaction", async () => {
        state.balance = 100;

        const answer = await open("credits");
        const body = (await answer.json()) as { opening: { reward: { id: string } } };

        expect(answer.status).toBe(200);
        expect(body.opening.reward.id).toBe("r1");
        expect(state.chest).toEqual([{ userId: "u1", productId: "sword", quantity: 1 }]);
        expect(state.openings).toHaveLength(1);
        expect(db.$transaction).toHaveBeenCalledTimes(1);
    });

    it("pays a credits reward once, after taking the price", async () => {
        crate = crateRow({ rewards: [{ id: "r2", name: "500 credits", kind: "credits", productId: null, value: 500, weight: 1, rarity: "epic" }] });
        state.balance = 100;

        const answer = await open("credits");

        expect(answer.status).toBe(200);
        expect(state.creditMoves).toEqual([-100, 500]);
        expect(state.balance).toBe(500);
    });

    it("is refused without a charge when the balance cannot cover it", async () => {
        state.balance = 99;

        const answer = await open("credits");

        expect(answer.status).toBe(409);
        expect(((await answer.json()) as { code: string }).code).toBe("crate_not_enough_credits");
        expect(state.openings).toHaveLength(0);
        expect(db.$transaction).not.toHaveBeenCalled();
    });
});
