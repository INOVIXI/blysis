// @vitest-environment node
/**
 * A referral pays when the new member first pays for something, not when they
 * type a code.
 *
 * Applying a code used to pay the referrer on the spot. Nothing stood between
 * a person and a reward: no email check, no spend, no cap, so anybody could
 * register accounts, apply their own code on each and collect the reward every
 * time. Now the code only records the referral. The first order the referred
 * member pays for with money settles it, once, and an order of nobody else's
 * does.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

interface ReferralRow {
    id: string;
    referrerId: string | null;
    referredId: string | null;
    rewardAmount: number;
    status: string;
}

const db = {
    referrals: [] as ReferralRow[],
    users: new Map<string, { referralCode?: string; referredBy?: string | null; username: string }>(),
    next: 1,
};
const payments: { userId: string; amount: number; type: string }[] = [];
let paymentFails = false;

function matches(row: ReferralRow, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, want]) => {
        const have = (row as unknown as Record<string, unknown>)[key];
        if (want && typeof want === "object" && "not" in (want as object)) return have !== (want as { not: unknown }).not;
        return have === want;
    });
}

const prismaMock = {
    referral: {
        findUnique: vi.fn(async ({ where }: { where: { referredId: string } }) =>
            db.referrals.find((r) => r.referredId === where.referredId) ?? null,
        ),
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
            db.referrals.find((r) => matches(r, where)) ?? null,
        ),
        create: vi.fn(async ({ data }: { data: Omit<ReferralRow, "id"> }) => {
            const row = { id: `r${db.next++}`, ...data };
            db.referrals.push(row);
            return row;
        }),
        updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<ReferralRow> }) => {
            const hit = db.referrals.filter((r) => matches(r, where));
            for (const row of hit) Object.assign(row, data);
            return { count: hit.length };
        }),
    },
    user: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => db.users.get(where.id) ?? null),
        findFirst: vi.fn(async ({ where }: { where: { referralCode: string } }) => {
            for (const [id, user] of db.users) if (user.referralCode === where.referralCode) return { id, username: user.username };
            return null;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { referredBy?: string } }) => {
            Object.assign(db.users.get(where.id) ?? {}, data);
            return {};
        }),
    },
    setting: { findUnique: vi.fn(async () => ({ value: "7" })) },
    activityFeedItem: { create: vi.fn(async () => ({})) },
    $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => {
        // A real transaction undoes its writes when the callback throws.
        const before = db.referrals.map((r) => ({ ...r }));
        const paid = payments.length;
        try {
            return await run(prismaMock);
        } catch (error) {
            db.referrals = before;
            payments.length = paid;
            throw error;
        }
    },
};

vi.mock("@/core/sdk/server", () => ({
    prisma: prismaMock,
    rateLimitForRole: vi.fn(async () => ({ success: true })),
    readJsonBody: vi.fn(async (request: Request) => request.json()),
    log: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/core/sdk/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "newcomer", role: "member" } })) }));
vi.mock("nanoid", () => ({ nanoid: () => "abcdefgh" }));
vi.mock("@/core/sdk", () => ({
    doActionAsync: vi.fn(async () => undefined),
    applyFiltersAsync: vi.fn(
        async (hook: string, value: { applied: boolean }, ctx: { userId: string; amount: number; type: string }) => {
            if (hook !== "credit.change") return value;
            if (paymentFails) return { ...value, applied: false };
            payments.push({ userId: ctx.userId, amount: ctx.amount, type: ctx.type });
            return { ...value, applied: true };
        },
    ),
}));

const { POST } = await import("@/modules/referral/api/route");
const onOrderCompleted = (await import("@/modules/referral/hooks/on-order-completed")).default;

const applyCode = () =>
    POST(
        new Request("http://localhost/api/v1/referral", {
            method: "POST",
            body: JSON.stringify({ referralCode: "FRIEND01" }),
        }) as never,
    );

function order(overrides: Record<string, unknown> = {}) {
    return {
        id: "order-1",
        userId: "newcomer",
        total: 25,
        paymentMethod: "stripe",
        ...overrides,
    } as Parameters<typeof onOrderCompleted>[0];
}

const complete = (overrides: Record<string, unknown> = {}) =>
    onOrderCompleted(order(overrides), { hook: "store.order.completed" });

beforeEach(() => {
    db.referrals = [];
    db.users = new Map([
        ["friend", { referralCode: "FRIEND01", username: "friend" }],
        ["newcomer", { username: "newcomer" }],
        ["someone-else", { username: "someone-else" }],
    ]);
    db.next = 1;
    payments.length = 0;
    paymentFails = false;
    vi.clearAllMocks();
});

describe("applying a code", () => {
    it("records the referral and pays nothing", async () => {
        const response = await applyCode();

        expect(response.status).toBe(200);
        expect(db.referrals).toEqual([
            expect.objectContaining({ referrerId: "friend", referredId: "newcomer", rewardAmount: 7, status: "pending" }),
        ]);
        expect(payments).toEqual([]);
    });
});

describe("the first paid order of the referred member", () => {
    beforeEach(async () => {
        await applyCode();
    });

    it("pays the referrer the amount fixed when the code was applied", async () => {
        await complete();

        expect(payments).toEqual([{ userId: "friend", amount: 7, type: "referral_reward" }]);
        expect(db.referrals[0].status).toBe("rewarded");
    });

    it("pays once, however many orders follow and however often this one is announced", async () => {
        await complete();
        await complete();
        await complete({ id: "order-2" });

        expect(payments).toHaveLength(1);
    });

    it("pays once when two announcements of it arrive together", async () => {
        await Promise.all([complete(), complete()]);

        expect(payments).toHaveLength(1);
    });

    it("is not triggered by an order of somebody else's", async () => {
        await complete({ userId: "someone-else" });
        await complete({ userId: "friend" });
        await complete({ userId: null });

        expect(payments).toEqual([]);
        expect(db.referrals[0].status).toBe("pending");
    });

    it("is not triggered by an order that took no money", async () => {
        await complete({ total: 0 });
        await complete({ paymentMethod: "credits" });
        await complete({ paymentMethod: null });

        expect(payments).toEqual([]);
        expect(db.referrals[0].status).toBe("pending");
    });

    it("stays pending when the credits could not be paid, so the next order tries again", async () => {
        paymentFails = true;
        await expect(complete()).rejects.toThrow();
        expect(db.referrals[0].status).toBe("pending");

        paymentFails = false;
        await complete({ id: "order-2" });
        expect(payments).toHaveLength(1);
        expect(db.referrals[0].status).toBe("rewarded");
    });
});

describe("a member nobody referred", () => {
    it("buys without anything being paid to anyone", async () => {
        await complete();

        expect(payments).toEqual([]);
    });
});

describe("a referral paid before this rule existed", () => {
    it("is left as it is", async () => {
        db.referrals.push({ id: "old", referrerId: "friend", referredId: "newcomer", rewardAmount: 5, status: "rewarded" });

        await complete();

        expect(payments).toEqual([]);
        expect(db.referrals[0]).toMatchObject({ status: "rewarded", rewardAmount: 5 });
    });
});
