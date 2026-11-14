// @vitest-environment node
/**
 * The author of something a reviewing module rejected may ask a person to
 * look at it, once.
 *
 * The item goes back in the queue marked for a person, and no reviewer
 * touches it again; whatever the person then decides is final. A person's own
 * rejection offers no such button, since a person already looked. Anybody
 * other than the author, and an item that does not exist, get the same
 * answer, so the address says nothing about what somebody else wrote.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type State = "APPROVED" | "REJECTED" | "PENDING";

interface Item { id: string; authorId: string | null; state: State }
interface Decision { id: string; provider: string; itemId: string; state: string; reasonId: string | null; note: string | null; decidedById: string | null; reviewer: string | null; humanOnly: boolean; createdAt: Date }

let items: Item[] = [];
let decisions: Decision[] = [];
const fired: string[] = [];
let session: { user: { id: string } } | null = { user: { id: "u1" } };
let allowed = true;

vi.mock("@/core/generated/module-moderation", () => ({
    ModuleModerationReviewers: [],
    ModuleModerationProviders: [{
        id: "forum-post", label: "Forum posts", module: "forum",
        loader: async () => ({
            default: {
                count: async () => 0,
                list: async () => ({ items: [], total: 0 }),
                read: async (ids: string[]) => items.filter((i) => ids.includes(i.id)).map((i) => ({ ...i, body: "text" })),
                bulkUpdate: async (ids: string[], state: State) => {
                    for (const i of items) if (ids.includes(i.id)) i.state = state;
                    return ids.length;
                },
            },
        }),
    }],
}));
vi.mock("@/core/lib/module-cache", () => ({ getModuleStates: async () => ({}) }));
vi.mock("@/core/lib/hooks", () => ({ doActionAsync: async (name: string) => { fired.push(name); } }));
vi.mock("@/core/lib/moderation-reasons", () => ({ listReasons: async () => [] }));
vi.mock("@/core/lib/auth", () => ({ auth: async () => session }));
vi.mock("@/core/lib/activity-log", () => ({ logActivity: async () => undefined }));
vi.mock("@/core/lib/rate-limit", () => ({
    rateLimit: async () => ({ success: allowed, remaining: allowed ? 1 : 0, resetAt: Date.now() + 1000 }),
    getClientIP: () => "203.0.113.9",
}));
vi.mock("@/core/lib/db", () => ({
    prisma: {
        moderationDecision: {
            createManyAndReturn: async ({ data }: { data: (Omit<Decision, "id" | "createdAt" | "humanOnly"> & { humanOnly?: boolean })[] }) => {
                const rows = data.map((d, n) => ({
                    ...d, humanOnly: d.humanOnly === true, id: `d${decisions.length + n + 1}`, createdAt: new Date(1000 + decisions.length + n),
                }));
                decisions.push(...rows);
                return rows.map((r) => ({ id: r.id, itemId: r.itemId }));
            },
            findMany: async ({ where }: { where: { provider: string; itemId: string | { in: string[] } } }) =>
                decisions
                    .filter((d) => d.provider === where.provider && (typeof where.itemId === "string" ? d.itemId === where.itemId : where.itemId.in.includes(d.itemId)))
                    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                    .map((d) => ({ ...d, decidedBy: d.decidedById ? { id: d.decidedById, username: "someone" } : null })),
        },
    },
}));

const { askPerson } = await import("@/core/lib/moderation-ask-person");
const { readNotice } = await import("@/core/lib/moderation-notice");
const route = await import("@/app/api/v1/moderation/[provider]/[id]/ask-person/route");
const { NextRequest } = await import("next/server");

function rejectedBy(by: "reviewer" | "person", at = 1): Decision {
    return {
        id: `r${at}`, provider: "forum-post", itemId: "p1", state: "REJECTED", reasonId: "spam", note: null,
        decidedById: by === "person" ? "mod-1" : null, reviewer: by === "reviewer" ? "ai-moderation" : null,
        humanOnly: false, createdAt: new Date(at),
    };
}

function ask(provider = "forum-post", id = "p1") {
    return route.POST(new NextRequest(`http://x/api/v1/moderation/${provider}/${id}/ask-person`, { method: "POST" }), {
        params: Promise.resolve({ provider, id }),
    });
}

beforeEach(() => {
    items = [{ id: "p1", authorId: "u1", state: "REJECTED" }, { id: "p2", authorId: "u1", state: "PENDING" }];
    decisions = [rejectedBy("reviewer")];
    fired.length = 0;
    session = { user: { id: "u1" } };
    allowed = true;
});

describe("asking a person", () => {
    it("puts a reviewer's rejection back in the queue for a person, quietly", async () => {
        expect(await askPerson("forum-post", "p1", "u1")).toBe("ok");
        expect(items[0].state).toBe("PENDING");
        expect(decisions.at(-1)).toMatchObject({ state: "PENDING", humanOnly: true, decidedById: "u1", reviewer: null });
        // The author did this themselves; telling them it happened is noise.
        expect(fired).toEqual([]);
    });

    it("is not offered for a person's rejection", async () => {
        decisions = [rejectedBy("person")];
        expect(await askPerson("forum-post", "p1", "u1")).toBe("not_allowed");
        expect(items[0].state).toBe("REJECTED");
    });

    it("is offered once: a person's later rejection stands", async () => {
        await askPerson("forum-post", "p1", "u1");
        decisions.push({ ...rejectedBy("person", 5000), id: "r2" });
        items[0].state = "REJECTED";
        expect(await askPerson("forum-post", "p1", "u1")).toBe("not_allowed");
    });

    it("refuses an item that is not rejected", async () => {
        decisions = [];
        expect(await askPerson("forum-post", "p2", "u1")).toBe("not_allowed");
    });

    it("answers somebody else as it answers an item that does not exist", async () => {
        expect(await askPerson("forum-post", "p1", "u2")).toBe("not_found");
        expect(await askPerson("forum-post", "nope", "u1")).toBe("not_found");
        expect(await askPerson("unknown-kind", "p1", "u1")).toBe("not_found");
        expect(items[0].state).toBe("REJECTED");
    });
});

describe("the author's notice", () => {
    it("offers the button for a reviewer's rejection, and says a person will look once asked", async () => {
        expect(await readNotice("forum-post", "p1", "u1", "en")).toMatchObject({ canAskPerson: true, askedPerson: false });
        await askPerson("forum-post", "p1", "u1");
        expect(await readNotice("forum-post", "p1", "u1", "en")).toMatchObject({ state: "PENDING", canAskPerson: false, askedPerson: true });
    });

    it("does not offer it for a person's rejection", async () => {
        decisions = [rejectedBy("person")];
        expect(await readNotice("forum-post", "p1", "u1", "en")).toMatchObject({ canAskPerson: false, askedPerson: false });
    });
});

describe("POST /api/v1/moderation/[provider]/[id]/ask-person", () => {
    it("asks a person for the signed-in author", async () => {
        const res = await ask();
        expect(res.status).toBe(200);
        expect(items[0].state).toBe("PENDING");
    });

    it("needs a session", async () => {
        session = null;
        expect((await ask()).status).toBe(401);
    });

    it("is rate limited", async () => {
        allowed = false;
        const res = await ask();
        expect(res.status).toBe(429);
        expect((await res.json()).code).toBe("rate_limited");
        expect(items[0].state).toBe("REJECTED");
    });

    it("answers a stranger with not found, and a second ask with a refusal", async () => {
        session = { user: { id: "u2" } };
        expect((await ask()).status).toBe(404);
        session = { user: { id: "u1" } };
        await ask();
        decisions.push({ ...rejectedBy("person", 5000), id: "r2" });
        items[0].state = "REJECTED";
        const res = await ask();
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe("not_allowed");
    });
});
