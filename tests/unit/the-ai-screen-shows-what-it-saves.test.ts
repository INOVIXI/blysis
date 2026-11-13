// @vitest-environment node
/**
 * The AI screen's endpoint: what the operator reads and what they may write.
 *
 * It is the panel's, it reports the providers and limits as core will use
 * them, it totals only the usage inside the window it says it shows, and it
 * refuses a limit outside the bounds core enforces rather than saving one
 * that would be clamped into something the operator did not type.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

interface UsageRow {
    module: string;
    purpose: string;
    outcome: string;
    inputTokens: number;
    outputTokens: number;
    createdAt: Date;
}

const state = vi.hoisted(() => ({
    session: null as { user: { id: string; role?: string } } | null,
    admin: false,
    settings: {} as Record<string, unknown>,
    written: new Map<string, unknown>(),
    cleared: [] as string[],
    usage: [] as UsageRow[],
    states: {} as Record<string, boolean>,
    logged: [] as { action: string }[],
}));

vi.mock("@/core/lib/auth", () => ({ auth: async () => state.session }));
vi.mock("@/core/lib/permissions", () => ({ isAdmin: async () => state.admin }));
vi.mock("@/core/lib/activity-log", () => ({
    logActivity: async (entry: { action: string }) => {
        state.logged.push(entry);
    },
}));
vi.mock("@/core/lib/setting-values", () => ({
    readSettingValues: async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in state.settings).map((k) => [k, state.settings[k]])),
}));
vi.mock("@/core/lib/module-cache", () => ({ getModuleStates: async () => state.states }));
vi.mock("@/core/lib/site-time-setting", () => ({ siteTimeZone: async () => "UTC" }));
vi.mock("@/core/lib/ai", () => ({
    aiProviderStatus: async () => [
        { id: "alpha", name: "Alpha AI", enabled: true, configured: true },
        { id: "beta", name: "Beta AI", enabled: true, configured: false },
    ],
    activeAiProviderId: async () => (state.settings.ai_active_provider as string | undefined) ?? null,
}));
vi.mock("@/core/generated/module-data", () => ({
    ModuleAiPurposes: [
        { module: "example-reviewer", id: "review", labelKey: "exampleReviewer_purposeReview", sendsKey: "exampleReviewer_sendsReview" },
        { module: "example-off", id: "help", labelKey: "exampleOff_purposeHelp", sendsKey: "exampleOff_sendsHelp" },
    ],
}));
vi.mock("@/core/lib/db", () => {
    const upsert = async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => {
        state.written.set(where.key, create.value);
        return {};
    };
    const deleteMany = async ({ where }: { where: { key: string } }) => {
        state.cleared.push(where.key);
        return { count: 1 };
    };
    return {
        prisma: {
            setting: { upsert, deleteMany },
            $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
            aiUsage: {
                groupBy: async ({ where }: { where: { createdAt: { gte: Date } } }) => {
                    const groups = new Map<string, { module: string; purpose: string; outcome: string; _count: { _all: number }; _sum: { inputTokens: number; outputTokens: number } }>();
                    for (const row of state.usage.filter((r) => r.createdAt >= where.createdAt.gte)) {
                        const key = `${row.module}|${row.purpose}|${row.outcome}`;
                        const group = groups.get(key) ?? { module: row.module, purpose: row.purpose, outcome: row.outcome, _count: { _all: 0 }, _sum: { inputTokens: 0, outputTokens: 0 } };
                        group._count._all += 1;
                        group._sum.inputTokens += row.inputTokens;
                        group._sum.outputTokens += row.outputTokens;
                        groups.set(key, group);
                    }
                    return [...groups.values()];
                },
            },
        },
    };
});

const { GET, PATCH } = await import("@/app/api/v1/admin/ai/route");

const DAY = 24 * 60 * 60 * 1000;

function patch(body: unknown) {
    return PATCH(new NextRequest("http://site.test/api/v1/admin/ai", {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
    }));
}

function signInAsAdmin() {
    state.session = { user: { id: "u1", role: "admin" } };
    state.admin = true;
}

beforeEach(() => {
    state.session = null;
    state.admin = false;
    state.settings = {};
    state.written = new Map();
    state.cleared = [];
    state.usage = [];
    state.states = { "example-off": false };
    state.logged = [];
});

describe("reading the screen", () => {
    it("is the panel's", async () => {
        expect((await GET()).status).toBe(401);
        state.session = { user: { id: "u1" } };
        expect((await GET()).status).toBe(403);
    });

    it("says nothing is chosen when two providers wait for a choice", async () => {
        signInAsAdmin();
        const body = await (await GET()).json();
        expect(body.providers.map((p: { id: string }) => p.id)).toEqual(["alpha", "beta"]);
        expect(body.active).toBeNull();
    });

    it("gives the limits core will use, defaults included", async () => {
        signInAsAdmin();
        state.settings = { ai_daily_token_limit: 5000 };
        const body = await (await GET()).json();
        expect(body.settings).toEqual({
            timeoutSeconds: 30,
            dailyTokenLimit: 5000,
            requestsPerMinute: 30,
            retentionDays: 90,
            moduleTokenLimits: {},
        });
    });

    it("lists what leaves the site for switched-on modules only", async () => {
        signInAsAdmin();
        const body = await (await GET()).json();
        expect(body.purposes).toEqual([
            { module: "example-reviewer", id: "review", labelKey: "exampleReviewer_purposeReview", sendsKey: "exampleReviewer_sendsReview" },
        ]);
    });

    it("totals only the usage inside the window it shows", async () => {
        signInAsAdmin();
        const now = Date.now();
        state.usage = [
            { module: "example-reviewer", purpose: "review", outcome: "ok", inputTokens: 100, outputTokens: 20, createdAt: new Date(now - 1 * DAY) },
            { module: "example-reviewer", purpose: "review", outcome: "invalid_output", inputTokens: 50, outputTokens: 10, createdAt: new Date(now - 2 * DAY) },
            { module: "example-reviewer", purpose: "review", outcome: "ok", inputTokens: 9999, outputTokens: 9999, createdAt: new Date(now - 40 * DAY) },
        ];
        const body = await (await GET()).json();
        expect(body.windowDays).toBe(30);
        expect(body.usage).toEqual([
            { module: "example-reviewer", purpose: "review", requests: 2, tokens: 180, errors: 1 },
        ]);
    });
});

describe("saving the screen", () => {
    it("is the panel's", async () => {
        expect((await patch({ timeoutSeconds: 30 })).status).toBe(401);
        state.session = { user: { id: "u1" } };
        expect((await patch({ timeoutSeconds: 30 })).status).toBe(403);
    });

    it.each([
        { timeoutSeconds: 4 },
        { timeoutSeconds: 121 },
        { timeoutSeconds: 12.5 },
        { dailyTokenLimit: -1 },
        { requestsPerMinute: -1 },
        { retentionDays: 0 },
        { retentionDays: 3651 },
        { moduleTokenLimits: { "example-reviewer": -5 } },
        { moduleTokenLimits: { "../etc": 5 } },
    ])("refuses %j rather than clamping it", async (body) => {
        signInAsAdmin();
        expect((await patch(body)).status).toBe(400);
        expect(state.written.size).toBe(0);
    });

    it("refuses a provider that is not installed", async () => {
        signInAsAdmin();
        const response = await patch({ active: "gamma" });
        expect(response.status).toBe(400);
        expect((await response.json()).code).toBe("ai_provider_unknown");
    });

    it("saves what it was sent under the keys core reads, and says so in the log", async () => {
        signInAsAdmin();
        const response = await patch({
            active: "beta",
            timeoutSeconds: 45,
            dailyTokenLimit: 20000,
            requestsPerMinute: 0,
            retentionDays: 30,
            moduleTokenLimits: { "example-reviewer": 5000 },
        });
        expect(response.status).toBe(200);
        expect(Object.fromEntries(state.written)).toEqual({
            ai_active_provider: "beta",
            ai_timeout_seconds: 45,
            ai_daily_token_limit: 20000,
            ai_requests_per_minute: 0,
            ai_usage_retention_days: 30,
            ai_module_token_limits: { "example-reviewer": 5000 },
        });
        expect(state.logged.map((entry) => entry.action)).toEqual(["ai.settings.update"]);
    });

    it("clears the choice when sent null, leaving one installed provider to answer alone", async () => {
        signInAsAdmin();
        expect((await patch({ active: null })).status).toBe(200);
        expect(state.cleared).toEqual(["ai_active_provider"]);
    });

    it("leaves what it was not sent alone", async () => {
        signInAsAdmin();
        await patch({ retentionDays: 60 });
        expect([...state.written.keys()]).toEqual(["ai_usage_retention_days"]);
    });
});
