// @vitest-environment node
/**
 * A wheel with a cooldown turns once however many requests ask together.
 *
 * The cooldown was checked from the last spin read before the transaction.
 * Twenty requests sent together all read "no recent spin", and each of them
 * won a prize, and each of them paid the cost of a turn. The turn now takes a
 * lock on the member and the wheel inside its transaction and reads the last
 * spin again there, so the second request waits for the first and then sees
 * its spin.
 *
 * The fake database below holds a lock per key until its transaction ends,
 * which is what `pg_advisory_xact_lock` does. Every request reads the last
 * spin before any of them writes, which is the interleaving that broke it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const REQUESTS = 20;

interface SpinRow {
    userId: string;
    wheelId: string;
    createdAt: Date;
}

const state = {
    spins: [] as SpinRow[],
    charged: 0,
    early: 0,
    release: null as null | (() => void),
    gate: null as null | Promise<void>,
};
const locks = new Map<string, Promise<void>>();

function wheelRow(overrides: Record<string, unknown> = {}) {
    return {
        id: "w1",
        slug: "daily",
        name: "Daily wheel",
        cooldown: "daily",
        cooldownHours: 24,
        cost: 0,
        roleIds: [] as string[],
        isActive: true,
        prizes: [{ id: "p1", name: "Ten credits", type: "credits", value: 10, probability: 1, color: "#fff", isActive: true }],
        ...overrides,
    };
}
let wheel = wheelRow();

function lastSpinOf(userId: string, wheelId: string) {
    const rows = state.spins.filter((s) => s.userId === userId && s.wheelId === wheelId);
    return rows.length > 0 ? { createdAt: rows[rows.length - 1].createdAt } : null;
}

function makeTx(held: Array<() => void>) {
    return {
        $executeRaw: vi.fn(async (_parts: TemplateStringsArray, key: string) => {
            while (locks.has(key)) await locks.get(key);
            let free!: () => void;
            locks.set(key, new Promise<void>((resolve) => (free = resolve)));
            held.push(() => {
                locks.delete(key);
                free();
            });
            return 1;
        }),
        wheelSpin: {
            findFirst: vi.fn(async (args: { where: { userId: string; wheelId: string } }) => lastSpinOf(args.where.userId, args.where.wheelId)),
            create: vi.fn(async (args: { data: { userId: string; wheelId: string } }) => {
                // A real insert takes a moment; without it the rows would
                // land in the same tick and hide the interleaving.
                await new Promise((resolve) => setTimeout(resolve, 1));
                state.spins.push({ userId: args.data.userId, wheelId: args.data.wheelId, createdAt: new Date() });
            }),
        },
    };
}

const db = {
    wheel: { findFirst: vi.fn(async () => wheel) },
    user: { findUnique: vi.fn(async () => ({ creditBalance: 1000, roleId: null })) },
    wheelSpin: {
        // Held until every request has asked, so all of them see the same
        // empty history.
        findFirst: vi.fn(async (args: { where: { userId: string; wheelId: string } }) => {
            const seen = lastSpinOf(args.where.userId, args.where.wheelId);
            state.early += 1;
            if (state.early >= REQUESTS) state.release?.();
            await state.gate;
            return seen;
        }),
    },
    activityFeedItem: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (work: (t: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        const held: Array<() => void> = [];
        try {
            return await work(makeTx(held));
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
    applyFiltersAsync: vi.fn(async (hook: string, value: unknown, args: { amount?: number }) => {
        if (hook === "credit.change" && (args.amount ?? 0) < 0) {
            state.charged += 1;
            return { applied: true };
        }
        return value;
    }),
    doActionAsync: vi.fn(async () => undefined),
}));

const { POST } = await import("@/modules/wheel/api/spin/route");

function spin() {
    return POST(new Request("http://localhost/api/v1/wheel/spin?wheel=daily") as never);
}

beforeEach(() => {
    vi.clearAllMocks();
    locks.clear();
    state.spins = [];
    state.charged = 0;
    state.early = 0;
    state.gate = new Promise<void>((resolve) => (state.release = resolve));
    wheel = wheelRow();
});

async function sendTogether() {
    const answers = await Promise.all(Array.from({ length: REQUESTS }, () => spin()));
    return Promise.all(answers.map(async (r) => ({ status: r.status, body: (await r.json()) as { code?: string; prize?: unknown } })));
}

describe("a wheel with a cooldown", () => {
    it("is turned once when the requests arrive together", async () => {
        const answers = await sendTogether();

        expect(answers.filter((a) => a.status === 200)).toHaveLength(1);
        expect(state.spins).toHaveLength(1);
        for (const refused of answers.filter((a) => a.status !== 200)) {
            expect(refused.status).toBe(429);
            expect(refused.body.code).toBe("wheel_too_soon");
        }
    });

    it("charges the cost of a turn once, not once per request", async () => {
        wheel = wheelRow({ cost: 5 });

        const answers = await sendTogether();

        expect(answers.filter((a) => a.status === 200)).toHaveLength(1);
        expect(state.charged).toBe(1);
    });

    it("still turns again once the cooldown has passed", async () => {
        state.spins.push({ userId: "u1", wheelId: "w1", createdAt: new Date(Date.now() - 25 * 3_600_000) });
        state.gate = Promise.resolve();

        const answer = await spin();

        expect(answer.status).toBe(200);
        expect(state.spins).toHaveLength(2);
    });
});

describe("a wheel with no cooldown", () => {
    it("takes no lock, so turns are not queued behind each other", async () => {
        wheel = wheelRow({ cooldown: "none" });
        state.gate = Promise.resolve();

        const answer = await spin();

        expect(answer.status).toBe(200);
        expect(locks.size).toBe(0);
    });
});
