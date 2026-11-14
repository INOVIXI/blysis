// @vitest-environment node
/**
 * What a module may do with the moderation queue, through the SDK.
 *
 * A reviewing module needs to list the kinds and reasons an admin chooses
 * from, show a post it judged, and let an admin take its decision back. It
 * gets each through core, with the queue's own rules: a kind whose module is
 * switched off or cannot read its items reads as nothing, and a rejection
 * needs one of the site's enabled reasons, as the queue screen's does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type State = "APPROVED" | "REJECTED" | "PENDING";

let items: { id: string; authorId: string | null; state: State }[] = [];
let states: Record<string, boolean> = {};
let reasons: Record<string, boolean> = {};
const decided: { provider: string; ids: string[]; state: State; reasonId?: string | null; decidedById?: string | null }[] = [];

vi.mock("@/core/generated/module-moderation", () => ({
    ModuleModerationReviewers: [],
    ModuleModerationProviders: [
        {
            id: "forum-post", label: "Forum posts", labelKey: "moderation_forumPost", module: "forum",
            loader: async () => ({
                default: {
                    count: async () => 0,
                    list: async () => ({ items: [], total: 0 }),
                    read: async (ids: string[]) => items.filter((i) => ids.includes(i.id)).map((i) => ({ ...i, body: `body ${i.id}` })),
                    bulkUpdate: async () => 0,
                },
            }),
        },
        {
            id: "old-kind", label: "Old", module: "old",
            loader: async () => ({ default: { count: async () => 0, list: async () => ({ items: [], total: 0 }), bulkUpdate: async () => 0 } }),
        },
        {
            id: "blog-comment", label: "Blog comments", labelKey: "moderation_blogComment", module: "blog",
            loader: async () => ({ default: { count: async () => 0, list: async () => ({ items: [], total: 0 }), read: async () => [], bulkUpdate: async () => 0 } }),
        },
    ],
}));
vi.mock("@/core/lib/module-cache", () => ({ getModuleStates: async () => states }));
vi.mock("@/core/lib/db", () => ({
    prisma: {
        moderationReason: {
            findUnique: async ({ where }: { where: { id: string } }) => (where.id in reasons ? { enabled: reasons[where.id] } : null),
        },
    },
}));
vi.mock("@/core/lib/moderation-decisions", () => ({
    decide: async (provider: { id: string }, input: { ids: string[]; state: State; reasonId?: string | null; decidedById?: string | null }) => {
        decided.push({ provider: provider.id, ids: input.ids, state: input.state, reasonId: input.reasonId, decidedById: input.decidedById });
        return { affected: input.ids };
    },
}));

const { moderationKinds, readModerated, moderate } = await import("@/core/lib/moderation-access");

beforeEach(() => {
    items = [{ id: "p1", authorId: "u1", state: "REJECTED" }];
    states = {};
    reasons = { spam: true, retired: false };
    decided.length = 0;
});

describe("moderationKinds", () => {
    it("lists the kinds of modules that are on, with the key their name is translated under", async () => {
        states = { blog: false };
        expect(await moderationKinds()).toEqual([
            { id: "forum-post", label: "Forum posts", labelKey: "moderation_forumPost", readable: true },
            { id: "old-kind", label: "Old", readable: false },
        ]);
    });
});

describe("readModerated", () => {
    it("reads what was written", async () => {
        expect(await readModerated("forum-post", ["p1"])).toEqual([{ id: "p1", authorId: "u1", state: "REJECTED", body: "body p1" }]);
    });

    it("reads nothing from a kind that cannot read, is switched off, or does not exist", async () => {
        expect(await readModerated("old-kind", ["p1"])).toEqual([]);
        states = { forum: false };
        expect(await readModerated("forum-post", ["p1"])).toEqual([]);
        expect(await readModerated("nope", ["p1"])).toEqual([]);
    });
});

describe("moderate", () => {
    it("decides as the person named", async () => {
        expect(await moderate({ kind: "forum-post", ids: ["p1"], state: "APPROVED", decidedById: "admin-1" })).toEqual({ ok: true, affected: ["p1"] });
        expect(decided).toEqual([{ provider: "forum-post", ids: ["p1"], state: "APPROVED", reasonId: null, decidedById: "admin-1" }]);
    });

    it("needs one of the site's enabled reasons to reject", async () => {
        expect(await moderate({ kind: "forum-post", ids: ["p1"], state: "REJECTED", decidedById: "a" })).toEqual({ ok: false, code: "reason_required" });
        expect(await moderate({ kind: "forum-post", ids: ["p1"], state: "REJECTED", reasonId: "retired", decidedById: "a" })).toEqual({ ok: false, code: "reason_unknown" });
        expect(await moderate({ kind: "forum-post", ids: ["p1"], state: "REJECTED", reasonId: "nope", decidedById: "a" })).toEqual({ ok: false, code: "reason_unknown" });
        expect(decided).toEqual([]);
    });

    it("refuses a kind that is switched off or unknown", async () => {
        states = { forum: false };
        expect(await moderate({ kind: "forum-post", ids: ["p1"], state: "APPROVED", decidedById: "a" })).toEqual({ ok: false, code: "unknown_kind" });
        expect(await moderate({ kind: "nope", ids: ["p1"], state: "APPROVED", decidedById: "a" })).toEqual({ ok: false, code: "unknown_kind" });
    });
});
