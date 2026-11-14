// @vitest-environment node
/**
 * The AI moderation screens: what the reviewer decided, why, and the way
 * back from it.
 *
 * Every route answers a manager only. The log reads what was written through
 * core, so a post its module can no longer show reads as gone rather than
 * failing. Taking a decision back is a person's decision through core's
 * `moderate`, recorded as the admin's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
    id: string; provider: string; itemId: string; version: string; authorId: string | null;
    verdict: string; applied: string; reasonId: string | null; confidence: number | null;
    rationale: string | null; model: string | null; error: string | null; createdAt: Date;
}

let session: { user: { id: string } } | null = { user: { id: "admin-1" } };
let permitted = true;
let rows: Row[] = [];
const moderated: Record<string, unknown>[] = [];
const deleted: unknown[] = [];
let settings: Record<string, unknown> = {};

function matches(row: Row, where: Record<string, unknown> = {}): boolean {
    if (where.applied && row.applied !== where.applied) return false;
    if (where.provider && row.provider !== where.provider) return false;
    if (typeof where.verdict === "string" && row.verdict !== where.verdict) return false;
    const verdictNot = (where.verdict as { not?: string } | undefined)?.not;
    if (verdictNot && row.verdict === verdictNot) return false;
    const created = where.createdAt as { gte?: Date; lt?: Date } | undefined;
    if (created?.gte && row.createdAt < created.gte) return false;
    if (created?.lt && row.createdAt >= created.lt) return false;
    const id = where.id as { in?: string[] } | undefined;
    if (id?.in && !id.in.includes(row.id)) return false;
    return true;
}

vi.mock("@/core/sdk/auth", () => ({ auth: async () => session }));
vi.mock("@/core/sdk/server", () => ({
    hasPermission: async () => permitted,
    readSettingValues: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, settings[k]])),
    siteTimeZone: async () => "UTC",
    pageParams: (params: URLSearchParams, opts: { defaultLimit: number }) => {
        const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
        return { page, limit: opts.defaultLimit, skip: (page - 1) * opts.defaultLimit };
    },
    readJsonBody: async (request: Request) => request.json(),
    logActivity: async () => undefined,
    moderationKinds: async () => [
        { id: "forum-post", label: "Forum posts", labelKey: "moderation_forumPost", readable: true },
        { id: "old-kind", label: "Old", readable: false },
    ],
    moderationReasons: async (locale: string) => [{ id: "spam", label: `Spam (${locale})` }],
    readModerated: async (kind: string, ids: string[]) =>
        kind === "forum-post" && ids.includes("p1") ? [{ id: "p1", authorId: "u1", title: "Hello", body: "Buy now", state: "REJECTED", href: "/forum/p1" }] : [],
    moderate: async (input: Record<string, unknown>) => {
        moderated.push(input);
        return { ok: true, affected: input.ids };
    },
    prisma: {
        aiModerationReview: {
            findMany: async ({ where, skip = 0, take = 1000 }: { where?: Record<string, unknown>; skip?: number; take?: number }) =>
                rows.filter((r) => matches(r, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(skip, skip + take),
            count: async ({ where }: { where?: Record<string, unknown> } = {}) => rows.filter((r) => matches(r, where)).length,
            findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
            deleteMany: async (args: unknown) => {
                deleted.push(args);
                return { count: 2 };
            },
        },
    },
}));

const list = await import("@/modules/ai-moderation/api/admin/reviews/route");
const detail = await import("@/modules/ai-moderation/api/admin/reviews/[id]/route");
const undo = await import("@/modules/ai-moderation/api/admin/undo/route");
const options = await import("@/modules/ai-moderation/api/admin/options/route");
const stats = await import("@/modules/ai-moderation/api/stats/route");
const { default: prune } = await import("@/modules/ai-moderation/cron/prune");
const { NextRequest } = await import("next/server");

function row(id: string, applied: string, extra: Partial<Row> = {}): Row {
    return {
        id, provider: "forum-post", itemId: `item-${id}`, version: "v", authorId: "u1", verdict: applied === "leave" ? "unsure" : applied,
        applied, reasonId: applied === "reject" ? "spam" : null, confidence: 95, rationale: "why", model: null, error: null,
        createdAt: new Date(), ...extra,
    };
}

function get(url: string) {
    return new NextRequest(`http://x/api/v1${url}`);
}

beforeEach(() => {
    session = { user: { id: "admin-1" } };
    permitted = true;
    rows = [row("r1", "approve"), row("r2", "reject", { itemId: "p1" }), row("r3", "leave", { createdAt: new Date(Date.now() - 3 * 86_400_000) })];
    moderated.length = 0;
    deleted.length = 0;
    settings = {};
});

describe("every route", () => {
    it("answers a manager only", async () => {
        const calls = [
            () => list.GET(get("/ai-moderation/admin/reviews")),
            () => detail.GET(get("/ai-moderation/admin/reviews/r1"), { params: Promise.resolve({ id: "r1" }) }),
            () => undo.POST(new NextRequest("http://x/api/v1/ai-moderation/admin/undo", { method: "POST", body: JSON.stringify({ ids: ["r1"], action: "requeue" }) })),
            () => options.GET(get("/ai-moderation/admin/options")),
            () => stats.GET(get("/ai-moderation/stats")),
        ];
        for (const call of calls) {
            session = null;
            expect((await call()).status).toBe(401);
            session = { user: { id: "member" } };
            permitted = false;
            expect((await call()).status).toBe(403);
            permitted = true;
        }
        expect(moderated).toEqual([]);
    });
});

describe("the log", () => {
    it("lists newest first, narrowed by what was applied, kind and period", async () => {
        let body = await (await list.GET(get("/ai-moderation/admin/reviews"))).json();
        expect(body.reviews.map((r: { id: string }) => r.id)).toEqual(["r1", "r2", "r3"]);
        expect(body.total).toBe(3);

        body = await (await list.GET(get("/ai-moderation/admin/reviews?applied=reject"))).json();
        expect(body.reviews.map((r: { id: string }) => r.id)).toEqual(["r2"]);

        body = await (await list.GET(get("/ai-moderation/admin/reviews?days=1"))).json();
        expect(body.reviews.map((r: { id: string }) => r.id)).toEqual(["r1", "r2"]);

        body = await (await list.GET(get("/ai-moderation/admin/reviews?kind=blog-comment"))).json();
        expect(body.reviews).toEqual([]);
    });

    it("refuses a filter it does not know", async () => {
        expect((await list.GET(get("/ai-moderation/admin/reviews?applied=ban"))).status).toBe(400);
    });

    it("shows one decision with what was written and the reason in the reader's language", async () => {
        const body = await (await detail.GET(get("/ai-moderation/admin/reviews/r2?locale=tr"), { params: Promise.resolve({ id: "r2" }) })).json();
        expect(body.review).toMatchObject({ id: "r2", applied: "reject", rationale: "why" });
        expect(body.item).toMatchObject({ title: "Hello", body: "Buy now", state: "REJECTED", href: "/forum/p1" });
        expect(body.reason).toBe("Spam (tr)");
    });

    it("shows a decision whose post its module can no longer show, with the post gone", async () => {
        const body = await (await detail.GET(get("/ai-moderation/admin/reviews/r1"), { params: Promise.resolve({ id: "r1" }) })).json();
        expect(body.item).toBeNull();
        expect((await detail.GET(get("/ai-moderation/admin/reviews/nope"), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
    });
});

describe("taking a decision back", () => {
    it("is the admin's own decision through core, per kind", async () => {
        rows.push(row("r4", "reject", { provider: "blog-comment", itemId: "c9" }));
        const res = await undo.POST(new NextRequest("http://x/api/v1/ai-moderation/admin/undo", {
            method: "POST",
            body: JSON.stringify({ ids: ["r2", "r4"], action: "approve" }),
        }));
        expect(res.status).toBe(200);
        expect(moderated).toEqual([
            { kind: "forum-post", ids: ["p1"], state: "APPROVED", decidedById: "admin-1" },
            { kind: "blog-comment", ids: ["c9"], state: "APPROVED", decidedById: "admin-1" },
        ]);
    });

    it("puts an item back in the queue", async () => {
        await undo.POST(new NextRequest("http://x/api/v1/ai-moderation/admin/undo", { method: "POST", body: JSON.stringify({ ids: ["r1"], action: "requeue" }) }));
        expect(moderated).toEqual([{ kind: "forum-post", ids: ["item-r1"], state: "PENDING", decidedById: "admin-1" }]);
    });

    it("refuses an action it does not know", async () => {
        const res = await undo.POST(new NextRequest("http://x/api/v1/ai-moderation/admin/undo", { method: "POST", body: JSON.stringify({ ids: ["r1"], action: "reject" }) }));
        expect(res.status).toBe(400);
        expect(moderated).toEqual([]);
    });
});

describe("the settings screen's choices", () => {
    it("are the kinds a reviewer can read and the site's reasons, in the reader's language", async () => {
        const body = await (await options.GET(get("/ai-moderation/admin/options?locale=tr"))).json();
        expect(body.kinds).toEqual([{ id: "forum-post", label: "Forum posts", labelKey: "moderation_forumPost", readable: true }]);
        expect(body.reasons).toEqual([{ id: "spam", label: "Spam (tr)" }]);
    });
});

describe("the dashboard", () => {
    it("counts today's decisions by what was applied, and the errors apart from what was left", async () => {
        rows.push(row("r5", "leave", { verdict: "error", error: "timeout" }));
        rows.push(row("r6", "leave"));
        const body = await (await stats.GET(get("/ai-moderation/stats"))).json();
        const [section] = body.sections;
        expect(section.id).toBe("ai-moderation-today");
        expect(Object.fromEntries(section.items.map((i: { id: string; primary: string }) => [i.id, i.primary]))).toEqual({
            approve: "1", reject: "1", leave: "1", error: "1",
        });
    });
});

describe("the daily prune", () => {
    it("forgets decisions older than the operator's retention", async () => {
        settings = { ai_moderation_retention_days: 30 };
        const before = Date.now();
        await prune();
        const arg = deleted[0] as { where: { createdAt: { lt: Date } } };
        expect(Math.abs(arg.where.createdAt.lt.getTime() - (before - 30 * 86_400_000))).toBeLessThan(1000);
    });
});
