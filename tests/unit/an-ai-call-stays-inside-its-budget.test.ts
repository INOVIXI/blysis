// @vitest-environment node
/**
 * Every AI call costs the operator money, so core holds the limits they set
 * and refuses before a request leaves the site, never after.
 *
 * A daily cap counts the site's day: an operator in Istanbul who sets a
 * thousand tokens a day gets them back at their midnight, not at three in the
 * morning. Every call, answered or refused, leaves one usage row, and no row
 * carries what was asked or answered.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

interface Row {
    module: string;
    purpose: string;
    provider: string | null;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    outcome: string;
    durationMs: number;
    createdAt: Date;
}

let rows: Row[] = [];
let usageUnreadable = false;
let settings: Record<string, unknown> = {};
let zone = "UTC";
let calls = 0;
let answer: unknown = { verdict: "approve" };

const SECRET_POST = "my secret post about the server";
const SYSTEM_TEXT = "Decide whether the post follows the rules.";

vi.mock("@/core/generated/module-ai", () => ({
    AiProviderRegistry: {
        alpha: async () => ({
            isConfigured: async () => true,
            defaultModel: async () => "alpha-model",
            generate: async (req: { model: string }) => {
                calls++;
                return { output: answer, usage: { inputTokens: 300, outputTokens: 100, cachedInputTokens: 50 }, model: req.model };
            },
        }),
    },
}));
vi.mock("@/core/lib/module-cache", () => ({ getModuleStates: async () => ({}) }));
vi.mock("@/core/lib/setting-values", () => ({
    readSettingValues: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, settings[k]])),
}));
vi.mock("@/core/lib/site-time-setting", () => ({ siteTimeZone: async () => zone }));
vi.mock("@/core/lib/logger", () => ({
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    errorText: (e: unknown) => String(e),
}));
vi.mock("@/core/lib/db", () => ({
    prisma: {
        aiUsage: {
            create: async ({ data }: { data: Omit<Row, "createdAt"> }) => {
                rows.push({ ...data, createdAt: new Date() });
                return {};
            },
            aggregate: async ({ where }: { where: { createdAt: { gte: Date }; module?: string } }) => {
                if (usageUnreadable) throw new Error("database unreachable");
                const hit = rows.filter((r) => r.createdAt >= where.createdAt.gte && (!where.module || r.module === where.module));
                return {
                    _sum: {
                        inputTokens: hit.reduce((n, r) => n + r.inputTokens, 0),
                        outputTokens: hit.reduce((n, r) => n + r.outputTokens, 0),
                    },
                };
            },
            deleteMany: async ({ where }: { where: { createdAt: { lt: Date } } }) => {
                const before = rows.length;
                rows = rows.filter((r) => r.createdAt >= where.createdAt.lt);
                return { count: before - rows.length };
            },
        },
    },
}));

const { generateStructured } = await import("@/core/lib/ai");
const { pruneUsage } = await import("@/core/lib/ai-usage");
const { forgetMemoryRateLimits } = await import("@/core/lib/rate-limit");

const Verdict = z.object({ verdict: z.enum(["approve", "reject"]) });

function ask(module = "example-reviewer") {
    return generateStructured({
        module,
        purpose: "review",
        system: SYSTEM_TEXT,
        input: { untrusted: [{ label: "post", text: SECRET_POST }] },
        schema: Verdict,
    });
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
        return "ok";
    } catch (err) {
        return (err as { kind?: string }).kind ?? String(err);
    }
}

function spent(module: string, tokens: number, at: Date): Row {
    return {
        module, purpose: "review", provider: "alpha", model: "alpha-model",
        inputTokens: tokens, outputTokens: 0, cachedInputTokens: 0,
        outcome: "ok", durationMs: 10, createdAt: at,
    };
}

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
    rows = [];
    usageUnreadable = false;
    settings = {};
    zone = "UTC";
    calls = 0;
    answer = { verdict: "approve" };
    forgetMemoryRateLimits();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("the daily token cap", () => {
    it("refuses before the provider is asked once the site has spent it", async () => {
        settings.ai_daily_token_limit = 1000;
        rows.push(spent("another-module", 1000, new Date()));
        expect(await kindOf(ask())).toBe("budget_exhausted");
        expect(calls).toBe(0);
    });

    it("lets a call through while some of it is left", async () => {
        settings.ai_daily_token_limit = 1000;
        rows.push(spent("another-module", 999, new Date()));
        expect(await kindOf(ask())).toBe("ok");
    });

    it("is no cap at all when it is zero", async () => {
        settings.ai_daily_token_limit = 0;
        rows.push(spent("another-module", 10_000_000, new Date()));
        expect(await kindOf(ask())).toBe("ok");
    });

    it("counts what was answered, input and output both", async () => {
        settings.ai_daily_token_limit = 400;
        expect(await kindOf(ask())).toBe("ok");
        expect(await kindOf(ask())).toBe("budget_exhausted");
    });

    it("refuses when what was spent cannot be read, rather than guessing it was nothing", async () => {
        settings.ai_daily_token_limit = 1000;
        usageUnreadable = true;
        expect(await kindOf(ask())).toBe("budget_exhausted");
        expect(calls).toBe(0);
    });
});

describe("a module's own cap", () => {
    it("stops that module and not another", async () => {
        settings.ai_module_token_limits = { "example-reviewer": 500 };
        rows.push(spent("example-reviewer", 500, new Date()));
        expect(await kindOf(ask("example-reviewer"))).toBe("budget_exhausted");
        expect(await kindOf(ask("example-helper"))).toBe("ok");
    });

    it("reads the same from a saved JSON string", async () => {
        settings.ai_module_token_limits = JSON.stringify({ "example-reviewer": 500 });
        rows.push(spent("example-reviewer", 500, new Date()));
        expect(await kindOf(ask("example-reviewer"))).toBe("budget_exhausted");
    });

    it("is not counted against by another module's spending", async () => {
        settings.ai_module_token_limits = { "example-reviewer": 500 };
        rows.push(spent("example-helper", 5000, new Date()));
        expect(await kindOf(ask("example-reviewer"))).toBe("ok");
    });
});

describe("the day a cap counts", () => {
    it("starts at the site's midnight, not UTC's", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        // 01:30 on the 14th in Istanbul, still the 13th in UTC.
        vi.setSystemTime(new Date("2026-11-13T22:30:00Z"));
        settings.ai_daily_token_limit = 1000;
        // 23:00 on the 13th in Istanbul: yesterday there, today in UTC.
        rows.push(spent("another-module", 1000, new Date("2026-11-13T20:00:00Z")));

        zone = "UTC";
        expect(await kindOf(ask())).toBe("budget_exhausted");

        zone = "Europe/Istanbul";
        expect(await kindOf(ask())).toBe("ok");
    });
});

describe("the request rate", () => {
    it("refuses past the operator's requests per minute without asking the provider", async () => {
        settings.ai_requests_per_minute = 2;
        expect(await kindOf(ask())).toBe("ok");
        expect(await kindOf(ask())).toBe("ok");
        expect(await kindOf(ask())).toBe("rate_limited");
        expect(calls).toBe(2);
    });

    it("is no limit at all when it is zero", async () => {
        settings.ai_requests_per_minute = 0;
        for (let i = 0; i < 40; i++) expect(await kindOf(ask())).toBe("ok");
    });
});

describe("the usage record", () => {
    it("is one row for an answer, with its tokens and no text", async () => {
        await ask();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            module: "example-reviewer", purpose: "review", provider: "alpha", model: "alpha-model",
            inputTokens: 300, outputTokens: 100, cachedInputTokens: 50, outcome: "ok",
        });
        expect(typeof rows[0].durationMs).toBe("number");
        expect(JSON.stringify(rows)).not.toContain("secret post");
        expect(JSON.stringify(rows)).not.toContain(SYSTEM_TEXT);
    });

    it("is one row for an answer that did not fit, with the tokens it still cost", async () => {
        answer = { verdict: "maybe" };
        expect(await kindOf(ask())).toBe("invalid_output");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ outcome: "invalid_output", inputTokens: 300, outputTokens: 100 });
    });

    it("is one row for a refusal, with nothing spent", async () => {
        settings.ai_daily_token_limit = 1;
        rows.push(spent("another-module", 1, new Date()));
        expect(await kindOf(ask())).toBe("budget_exhausted");
        const mine = rows.filter((r) => r.module === "example-reviewer");
        expect(mine).toHaveLength(1);
        expect(mine[0]).toMatchObject({ outcome: "budget_exhausted", inputTokens: 0, outputTokens: 0 });
    });
});

describe("pruning the record", () => {
    it("deletes only rows older than the operator's retention", async () => {
        settings.ai_usage_retention_days = 30;
        rows.push(spent("a", 1, new Date(Date.now() - 31 * DAY)), spent("b", 1, new Date(Date.now() - 29 * DAY)));
        expect(await pruneUsage()).toBe(1);
        expect(rows.map((r) => r.module)).toEqual(["b"]);
    });

    it("keeps ninety days when the operator set nothing", async () => {
        rows.push(spent("a", 1, new Date(Date.now() - 91 * DAY)), spent("b", 1, new Date(Date.now() - 89 * DAY)));
        expect(await pruneUsage()).toBe(1);
        expect(rows.map((r) => r.module)).toEqual(["b"]);
    });
});
