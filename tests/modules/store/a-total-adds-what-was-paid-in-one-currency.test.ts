// @vitest-environment node
/**
 * A total adds money only once it is all in one currency.
 *
 * A shop that took lira for years and then set its base currency to dollars
 * still has every old order and top-up in lira. The homepage added those
 * amounts as if they were dollars, and a visitor reading in lira saw the sum
 * multiplied by the dollar rate again: a member who had paid 1,514 TRY was
 * shown as about 77,000 TRY. Every total the shop reports is checked here
 * against that case: lira rows, a dollar base, and a display in lira.
 *
 * The widget that says "this month" is also held to a month. It read the last
 * hundred orders ever placed, so on a site whose newest orders were from
 * January 2025 it showed January 2025 as this month.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/** Lira per dollar, the rate on file. */
const TRY_PER_USD = 51;
const RATES: Record<string, number> = { USD: 1, TRY: TRY_PER_USD };

type Row = Record<string, unknown>;

const db = {
    orders: [] as Row[],
    topUps: [] as Row[],
    users: [
        { id: "u-lira", username: "lira", avatar: null, creditBalance: 0 },
        { id: "u-dollar", username: "dollar", avatar: null, creditBalance: 0 },
    ] as Row[],
};

function matches(row: Row, where: Row | undefined): boolean {
    for (const [key, expected] of Object.entries(where ?? {})) {
        const value = row[key];
        if (expected && typeof expected === "object" && !(expected instanceof Date)) {
            const test = expected as { gte?: Date; not?: unknown; in?: unknown[] };
            if ("gte" in test && !((value as Date) >= (test.gte as Date))) return false;
            if ("not" in test && value === test.not) return false;
            if ("in" in test && !(test.in ?? []).includes(value)) return false;
        } else if (value !== expected) {
            return false;
        }
    }
    return true;
}

interface GroupArgs {
    by: string[];
    where?: Row;
    orderBy?: { _sum?: Record<string, "asc" | "desc"> };
    take?: number;
}

function groupBy(rows: Row[], args: GroupArgs) {
    const groups = new Map<string, Row & { _sum: Record<string, number>; _count: { _all: number } }>();
    for (const row of rows.filter((r) => matches(r, args.where))) {
        const id = args.by.map((k) => String(row[k])).join("|");
        let group = groups.get(id);
        if (!group) {
            group = { ...Object.fromEntries(args.by.map((k) => [k, row[k]])), _sum: { total: 0, amount: 0 }, _count: { _all: 0 } };
            groups.set(id, group);
        }
        group._sum.total += Number(row.total ?? 0);
        group._sum.amount += Number(row.amount ?? 0);
        group._count._all += 1;
    }
    let out = [...groups.values()];
    const field = Object.keys(args.orderBy?._sum ?? {})[0];
    if (field) out.sort((a, b) => b._sum[field] - a._sum[field]);
    if (args.take) out = out.slice(0, args.take);
    return out;
}

const prismaMock = {
    order: {
        groupBy: async (args: GroupArgs) => groupBy(db.orders, args),
        aggregate: async (args: { where?: Row }) => ({
            _sum: { total: db.orders.filter((r) => matches(r, args.where)).reduce((s, r) => s + Number(r.total), 0) },
        }),
        count: async (args?: { where?: Row }) => db.orders.filter((r) => matches(r, args?.where)).length,
        findMany: async (args: { where?: Row; take?: number }) =>
            db.orders
                .filter((r) => matches(r, args.where))
                .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
                .slice(0, args.take ?? Infinity)
                .map((r) => ({ ...r, user: db.users.find((u) => u.id === r.userId) ?? null, items: [] })),
    },
    creditTopUp: {
        groupBy: async (args: GroupArgs) => groupBy(db.topUps, args),
    },
    user: {
        findMany: async (args: { where?: Row }) => db.users.filter((u) => matches(u, args.where)),
        findUnique: async (args: { where: { id: string } }) => db.users.find((u) => u.id === args.where.id) ?? null,
    },
    product: { count: async () => 0, findMany: async () => [] },
    orderItem: { groupBy: async () => [] },
    setting: {
        findMany: async () => [{ key: "community_goal_target", value: 1000 }],
    },
    $queryRaw: async () => [],
};

vi.mock("@/core/sdk/server", () => ({
    prisma: prismaMock,
    isModuleEnabled: async () => true,
    siteCurrency: async () => "USD",
    formatSiteCurrency: async (amount: number) => `USD ${Number(amount).toFixed(2)}`,
    hasPermission: async () => true,
    moduleTranslator: async () => (key: string) => key,
    dailySeries: async () => [],
    dayLabels: () => [],
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/core/sdk", async () => ({
    // What the currency module answers: rates kept against one base, crossed.
    applyFiltersAsync: vi.fn(async (hook: string, value: unknown, context: { from: string; to: string }) => {
        if (hook !== "currency.rate") return value;
        const from = RATES[context.from];
        const to = RATES[context.to];
        return from && to ? to / from : null;
    }),
    formatCurrency: (amount: number, currency = "USD") => `${currency} ${amount.toFixed(2)}`,
    textFor: (await vi.importActual<typeof import("@/core/lib/i18n/translatable-text")>("@/core/lib/i18n/translatable-text")).textFor,
}));

vi.mock("@/core/sdk/auth", () => ({
    auth: async () => ({ user: { id: "admin" } }),
}));

/** What a visitor reading in lira is shown for an amount in the base currency. */
const inLira = (base: number) => Math.round(base * TRY_PER_USD);

function order(userId: string, total: number, currency: string, createdAt = new Date()): Row {
    return { userId, total, currency, status: "COMPLETED", createdAt, paymentMethod: "card" };
}

beforeEach(() => {
    db.orders = [];
    db.topUps = [];
});

async function widgetStats() {
    const { GET } = await import("@/modules/store/api/widget-stats/route");
    return (await GET()).json();
}

describe("the homepage widgets", () => {
    it("show a member who paid 1,514 lira as 1,514 lira, not 77,000", async () => {
        db.orders = [order("u-lira", 1514, "TRY")];

        const stats = await widgetStats();

        expect(stats.topCustomer.username).toBe("lira");
        expect(inLira(stats.topCustomer.total)).toBe(1514);
    });

    it("rank the top customer by what each paid, whatever it was paid in", async () => {
        db.orders = [order("u-lira", 1514, "TRY"), order("u-dollar", 100, "USD")];

        const stats = await widgetStats();

        // 100 dollars is more than 1,514 lira at 51 to the dollar.
        expect(stats.topCustomer.username).toBe("dollar");
        expect(stats.topBuyers.map((b: { username: string }) => b.username)).toEqual(["dollar", "lira"]);
    });

    it("mean this month when they say this month", async () => {
        db.orders = [
            order("u-lira", 9999, "TRY", new Date("2025-01-15T12:00:00Z")),
            order("u-dollar", 10, "USD"),
        ];

        const stats = await widgetStats();

        expect(stats.topCustomer.username).toBe("dollar");
        expect(stats.topCustomer.total).toBe(10);
    });

    it("show no top customer when nobody paid this month", async () => {
        db.orders = [order("u-lira", 9999, "TRY", new Date("2025-01-15T12:00:00Z"))];

        const stats = await widgetStats();

        expect(stats.topCustomer).toBeNull();
    });

    it("rank credit loaders by the top-ups they paid for, in one currency", async () => {
        db.topUps = [
            { userId: "u-lira", amount: 1514, currency: "TRY", status: "COMPLETED", createdAt: new Date("2025-01-15T12:00:00Z") },
            { userId: "u-dollar", amount: 100, currency: "USD", status: "COMPLETED", createdAt: new Date() },
            { userId: "u-lira", amount: 5000, currency: "TRY", status: "CANCELLED", createdAt: new Date() },
        ];

        const stats = await widgetStats();

        expect(stats.topCreditLoaders.map((l: { username: string }) => l.username)).toEqual(["dollar", "lira"]);
        expect(inLira(stats.topCreditLoaders[1].total)).toBe(1514);
    });

    it("leave out money nobody quotes a rate for rather than count it at face value", async () => {
        db.orders = [order("u-lira", 1514, "TRY"), order("u-lira", 5000, "XYZ")];

        const stats = await widgetStats();

        expect(inLira(stats.topCustomer.total)).toBe(1514);
    });
});

describe("the leaderboard's top spenders", () => {
    it("rank by what each paid, converted before it is added", async () => {
        db.orders = [order("u-lira", 1514, "TRY"), order("u-lira", 1514, "TRY"), order("u-dollar", 100, "USD")];
        const handler = (await import("@/modules/store/hooks/leaderboard-board")).default;

        const [board] = await handler([] as never, { boardId: "buyers", limit: 1 } as never);

        // 3,028 lira is 59.37 dollars, so the dollar buyer leads, and a limit
        // of one is cut after the conversion, not before it.
        expect(board.rows).toHaveLength(1);
        expect(board.rows[0]).toMatchObject({ username: "dollar", value: 100, rank: 1 });
    });
});

describe("the admin's revenue", () => {
    it("adds every order in the site's currency", async () => {
        db.orders = [order("u-lira", 1514, "TRY"), order("u-dollar", 100, "USD")];
        const { GET } = await import("@/modules/store/api/stats/route");

        const answer = await (await GET(new NextRequest("http://localhost/api/v1/store/stats?period=30"))).json();

        expect(answer.stats.revenue).toBeCloseTo(100 + 1514 / TRY_PER_USD, 2);
        const spenders = answer.rankings.find((r: { id: string }) => r.id === "store-top-spenders");
        expect(spenders.items.map((i: { id: string; value: number }) => [i.id, i.value])).toEqual([
            ["u-dollar", 100],
            ["u-lira", 29.69],
        ]);
    });

    it("says what one member spent in the site's currency", async () => {
        db.orders = [order("u-lira", 1514, "TRY")];
        const handler = (await import("@/modules/store/hooks/on-customer-panels")).default;

        const [panel] = await handler([] as never, { userId: "u-lira", locale: "tr" } as never);

        expect(panel.rows.find((r: { label: string }) => r.label === "adm_customerSpent")?.value).toBe("USD 29.69");
    });

    it("counts the community goal in the site's currency", async () => {
        db.orders = [order("u-lira", 1514, "TRY"), order("u-dollar", 100, "USD")];
        const { readCommunityGoal } = await import("@/modules/store/lib/community-goal");

        const goal = await readCommunityGoal();

        expect(goal.current).toBeCloseTo(129.69, 2);
    });
});
