// @vitest-environment node
/**
 * A decision in the moderation queue gives a reason, is recorded, and is
 * announced to the person who wrote the item.
 *
 * Only items that actually change are decided: two moderators rejecting the
 * same post, or a bulk reject that sweeps up something already rejected,
 * record one decision and tell the author once. A provider that cannot read
 * its items (one written before `read`) still has its decision recorded, and
 * nobody is told, because nobody can be named.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type State = "APPROVED" | "REJECTED" | "PENDING";

interface Item { id: string; authorId: string | null; state: State }

let items: Item[] = [];
let decisions: { id: string; provider: string; itemId: string; state: string; reasonId: string | null; note: string | null; decidedById: string | null; reviewer: string | null; createdAt: Date }[] = [];
const fired: { name: string; payload: unknown }[] = [];
let reasonEnabled: Record<string, boolean> = {};

function readable() {
    return {
        count: async () => items.filter((i) => i.state === "PENDING").length,
        list: async () => ({ items: [], total: 0 }),
        listRejected: async () => ({
            items: items.filter((i) => i.state === "REJECTED").map((i) => ({
                id: i.id, author: i.authorId ? { id: i.authorId, username: `${i.authorId}-name` } : null,
                preview: "text", createdAt: new Date(0),
            })),
            total: items.filter((i) => i.state === "REJECTED").length,
        }),
        read: async (ids: string[]) => items.filter((i) => ids.includes(i.id)).map((i) => ({ id: i.id, authorId: i.authorId, body: "text", state: i.state })),
        bulkUpdate: async (ids: string[], state: State) => {
            let n = 0;
            for (const i of items) if (ids.includes(i.id)) { i.state = state; n++; }
            return n;
        },
    };
}

/** A provider written before `read` and `listRejected` existed. */
function older() {
    const { count, list, bulkUpdate } = readable();
    return { count, list, bulkUpdate };
}

vi.mock("@/core/generated/module-moderation", () => ({
    ModuleModerationProviders: [
        { id: "forum-post", label: "Forum posts", module: "forum", loader: async () => ({ default: readable() }) },
        { id: "old-kind", label: "Old", module: "elsewhere", loader: async () => ({ default: older() }) },
    ],
}));

vi.mock("@/core/lib/db", () => ({
    prisma: {
        moderationReason: {
            findUnique: async ({ where }: { where: { id: string } }) =>
                where.id in reasonEnabled ? { id: where.id, enabled: reasonEnabled[where.id] } : null,
        },
        moderationDecision: {
            createManyAndReturn: async ({ data }: { data: Omit<(typeof decisions)[number], "id" | "createdAt">[] }) => {
                const rows = data.map((d, n) => ({
                    ...d,
                    id: `d${decisions.length + n + 1}`, createdAt: new Date(decisions.length + n),
                }));
                decisions.push(...rows);
                return rows.map((r) => ({ id: r.id, itemId: r.itemId }));
            },
            findMany: async ({ where }: { where: { provider: string; itemId: { in: string[] } } }) =>
                decisions
                    .filter((d) => d.provider === where.provider && where.itemId.in.includes(d.itemId))
                    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                    .map((d) => ({ ...d, decidedBy: d.decidedById ? { id: d.decidedById, username: "mod" } : null })),
        },
    },
}));

vi.mock("@/core/lib/hooks", () => ({
    doActionAsync: async (name: string, payload: unknown) => {
        fired.push({ name, payload });
    },
}));
vi.mock("@/core/lib/moderation-reasons", () => ({
    listReasons: async (locale: string) =>
        Object.keys(reasonEnabled).map((id) => ({ id, key: null, label: `${locale}:${id}`, enabled: reasonEnabled[id], position: 0 })),
}));
vi.mock("@/core/lib/auth", () => ({ auth: async () => ({ user: { id: "mod-1", role: "admin" } }) }));
vi.mock("@/core/lib/permissions", () => ({ isAdmin: async () => true }));
vi.mock("@/core/lib/module-cache", () => ({ getModuleStates: async () => ({}) }));
vi.mock("@/core/lib/activity-log", () => ({ logActivity: async () => undefined }));
vi.mock("@/core/lib/i18n/resolve-locale", () => ({ resolveLocaleFromRequest: async () => "tr" }));

const route = await import("@/app/api/v1/admin/moderation/route");
const { NextRequest } = await import("next/server");

function post(body: unknown) {
    return route.POST(new NextRequest("http://x/api/v1/admin/moderation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    }));
}

beforeEach(() => {
    items = [
        { id: "p1", authorId: "u1", state: "PENDING" },
        { id: "p2", authorId: "u2", state: "PENDING" },
        { id: "p3", authorId: "u3", state: "REJECTED" },
        { id: "p4", authorId: null, state: "PENDING" },
    ];
    decisions = [];
    fired.length = 0;
    reasonEnabled = { spam: true, retired: false };
});

describe("rejecting", () => {
    it("asks for a reason", async () => {
        const res = await post({ ids: ["p1"], type: "forum-post", action: "reject" });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe("reason_required");
        expect(items[0].state).toBe("PENDING");
    });

    it("refuses a reason that is switched off or does not exist", async () => {
        for (const reasonId of ["retired", "nope"]) {
            const res = await post({ ids: ["p1"], type: "forum-post", action: "reject", reasonId });
            expect(res.status).toBe(400);
            expect((await res.json()).code).toBe("reason_unknown");
        }
        expect(decisions).toEqual([]);
    });

    it("records one decision per item that changed and tells each author once", async () => {
        const res = await post({ ids: ["p1", "p2", "p3"], type: "forum-post", action: "reject", reasonId: "spam", note: "links" });
        expect(res.status).toBe(200);
        expect((await res.json()).affected).toBe(2);
        expect(decisions.map((d) => [d.itemId, d.state, d.reasonId, d.note, d.decidedById])).toEqual([
            ["p1", "REJECTED", "spam", "links", "mod-1"],
            ["p2", "REJECTED", "spam", "links", "mod-1"],
        ]);
        expect(fired.map((f) => f.name)).toEqual(["moderation.item.rejected", "moderation.item.rejected"]);
        expect(fired[0].payload).toEqual({ provider: "forum-post", itemId: "p1", authorId: "u1", decisionId: "d1" });
    });

    it("records a decision about an item whose author is gone, and tells nobody", async () => {
        await post({ ids: ["p4"], type: "forum-post", action: "reject", reasonId: "spam" });
        expect(decisions.map((d) => d.itemId)).toEqual(["p4"]);
        expect(fired).toEqual([]);
    });

    it("records a decision for a provider that cannot read its items, and tells nobody", async () => {
        const res = await post({ ids: ["p1"], type: "old-kind", action: "reject", reasonId: "spam" });
        expect(res.status).toBe(200);
        expect(decisions.map((d) => [d.provider, d.itemId])).toEqual([["old-kind", "p1"]]);
        expect(fired).toEqual([]);
    });
});

describe("taking a rejection back", () => {
    it("puts an item back in the queue and tells its author", async () => {
        const res = await post({ ids: ["p3"], type: "forum-post", action: "requeue" });
        expect(res.status).toBe(200);
        expect(items[2].state).toBe("PENDING");
        expect(fired.map((f) => f.name)).toEqual(["moderation.item.restored"]);
        expect(decisions[0]).toMatchObject({ itemId: "p3", state: "PENDING", reasonId: null });
    });

    it("approves a rejected item and tells its author", async () => {
        await post({ ids: ["p3"], type: "forum-post", action: "approve" });
        expect(items[2].state).toBe("APPROVED");
        expect(fired.map((f) => f.name)).toEqual(["moderation.item.restored"]);
    });

    it("approving something that was only waiting announces nothing", async () => {
        await post({ ids: ["p1"], type: "forum-post", action: "approve" });
        expect(items[0].state).toBe("APPROVED");
        expect(decisions).toHaveLength(1);
        expect(fired).toEqual([]);
    });
});

describe("the Rejected view", () => {
    it("is refused for a provider that cannot list what it rejected", async () => {
        const res = await route.GET(new NextRequest("http://x/api/v1/admin/moderation?type=old-kind&state=rejected"));
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe("not_supported");
    });

    it("says which kinds have one", async () => {
        const res = await route.GET(new NextRequest("http://x/api/v1/admin/moderation"));
        const body = await res.json();
        expect(body.types["forum-post"].canListRejected).toBe(true);
        expect(body.types["old-kind"].canListRejected).toBe(false);
    });

    it("shows each item's latest decision, its reason in the moderator's language even after that reason was switched off", async () => {
        await post({ ids: ["p1"], type: "forum-post", action: "reject", reasonId: "spam", note: "links" });
        reasonEnabled.spam = false;
        const res = await route.GET(new NextRequest("http://x/api/v1/admin/moderation?type=forum-post&state=rejected"));
        const body = await res.json();
        const p1 = body.items.find((i: { id: string }) => i.id === "p1");
        expect(p1.decision).toMatchObject({ reason: "tr:spam", note: "links", decidedBy: { id: "mod-1", username: "mod" }, reviewer: null });
        const p3 = body.items.find((i: { id: string }) => i.id === "p3");
        expect(p3.decision).toBeNull();
    });
});
