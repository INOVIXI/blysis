// @vitest-environment node
/**
 * Core's review round: what waits in a kind set to "review" is handed to the
 * reviewing module, and core alone applies the answer.
 *
 * The round fails towards a person. An answer core cannot apply (a reason the
 * site does not offer, an item it did not ask about) leaves the item waiting;
 * a reviewer that throws costs each item an attempt, and an item out of
 * attempts waits for a person for good. What a moderator decided, and what
 * its author asked a person to look at, is never the reviewer's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type State = "APPROVED" | "REJECTED" | "PENDING";

interface Item { id: string; authorId: string | null; title?: string; body: string; state: State }
interface ReviewRow { provider: string; itemId: string; version: string; reviewer: string; attempts: number; settled: boolean }
interface Verdict { itemId: string; decision: "approve" | "reject" | "leave"; reasonId?: string | null }

const kinds: Record<string, Item[]> = {};
let modes: Record<string, string> = {};
let reviewRows: ReviewRow[] = [];
let humanOnly: { provider: string; itemId: string }[] = [];
let enabledReasons: string[] = [];
let moduleStates: Record<string, boolean> | Error = {};
const decided: { provider: string; ids: string[]; state: State; reasonId?: string | null; reviewer?: string | null }[] = [];
const handed: string[][] = [];
let capacity = { perRun: 20, batchSize: 5, maxAttempts: 3, kinds: [] as string[] };
let answer: (items: { itemId: string }[]) => Promise<Verdict[]> = async (items) => items.map((i) => ({ itemId: i.itemId, decision: "leave" }));
let reviewers: { id: string; name: string; module: string }[] = [];

function providerFor(kind: string) {
    return {
        count: async () => kinds[kind].filter((i) => i.state === "PENDING").length,
        list: async (skip: number, take: number) => {
            const pending = kinds[kind].filter((i) => i.state === "PENDING");
            return {
                items: pending.slice(skip, skip + take).map((i) => ({ id: i.id, author: null, preview: i.body, createdAt: new Date(0) })),
                total: pending.length,
            };
        },
        read: async (ids: string[]) => kinds[kind].filter((i) => ids.includes(i.id)).map((i) => ({ ...i })),
        bulkUpdate: async () => 0,
    };
}

vi.mock("@/core/generated/module-moderation", () => ({
    get ModuleModerationProviders() {
        return [
            { id: "forum-post", label: "Forum posts", module: "forum", settingKey: "forum_posts", loader: async () => ({ default: providerFor("forum-post") }) },
            { id: "blog-comment", label: "Blog comments", module: "blog", settingKey: "blog_comments", loader: async () => ({ default: providerFor("blog-comment") }) },
            { id: "unreadable", label: "Old", module: "old", settingKey: "old_kind", loader: async () => ({ default: { count: async () => 0, list: async () => ({ items: [], total: 0 }), bulkUpdate: async () => 0 } }) },
        ];
    },
    get ModuleModerationReviewers() {
        return reviewers.map((r) => ({
            ...r,
            loader: async () => ({
                default: {
                    capacity: async () => capacity,
                    review: async (items: { itemId: string }[]) => {
                        handed.push(items.map((i) => i.itemId));
                        return answer(items);
                    },
                },
            }),
        }));
    },
}));

vi.mock("@/core/lib/module-cache", () => ({
    getModuleStates: async () => {
        if (moduleStates instanceof Error) throw moduleStates;
        return moduleStates;
    },
}));

vi.mock("@/core/lib/moderation-mode", () => ({
    moderationModes: async () => modes,
}));

vi.mock("@/core/lib/moderation-decisions", () => ({
    decide: async (provider: { id: string }, input: { ids: string[]; state: State; reasonId?: string | null; reviewer?: string | null }) => {
        decided.push({ provider: provider.id, ids: input.ids, state: input.state, reasonId: input.reasonId, reviewer: input.reviewer });
        for (const item of kinds[provider.id]) if (input.ids.includes(item.id)) item.state = input.state;
        return { affected: input.ids };
    },
}));

vi.mock("@/core/lib/db", () => ({
    prisma: {
        moderationReason: {
            findMany: async () => enabledReasons.map((id) => ({ id })),
        },
        moderationDecision: {
            findMany: async ({ where }: { where: { provider: string; itemId: { in: string[] }; humanOnly: true } }) =>
                humanOnly.filter((h) => h.provider === where.provider && where.itemId.in.includes(h.itemId)).map((h) => ({ itemId: h.itemId })),
        },
        moderationReview: {
            findMany: async ({ where }: { where: { provider: string; itemId: { in: string[] } } }) =>
                reviewRows.filter((r) => r.provider === where.provider && where.itemId.in.includes(r.itemId)),
            upsert: async ({ where, create, update }: {
                where: { provider_itemId_version: { provider: string; itemId: string; version: string } };
                create: ReviewRow;
                update: { attempts?: { increment: number }; settled?: boolean; reviewer?: string };
            }) => {
                const key = where.provider_itemId_version;
                const row = reviewRows.find((r) => r.provider === key.provider && r.itemId === key.itemId && r.version === key.version);
                if (!row) {
                    reviewRows.push({ ...create });
                    return create;
                }
                if (update.attempts) row.attempts += update.attempts.increment;
                if (update.settled !== undefined) row.settled = update.settled;
                return row;
            },
        },
    },
}));

const { runReviewRound } = await import("@/core/lib/moderation-review");

function post(id: string, body = `text of ${id}`): Item {
    return { id, authorId: `author-${id}`, body, state: "PENDING" };
}

beforeEach(() => {
    kinds["forum-post"] = [post("p1"), post("p2")];
    kinds["blog-comment"] = [post("c1")];
    kinds.unreadable = [];
    modes = { forum_posts: "review", blog_comments: "manual" };
    reviewRows = [];
    humanOnly = [];
    enabledReasons = ["spam"];
    moduleStates = {};
    decided.length = 0;
    handed.length = 0;
    capacity = { perRun: 20, batchSize: 5, maxAttempts: 3, kinds: [] };
    answer = async (items) => items.map((i) => ({ itemId: i.itemId, decision: "leave" }));
    reviewers = [{ id: "ai-moderation", name: "AI moderation", module: "ai-moderation" }];
});

describe("a review round", () => {
    it("applies the reviewer's approvals and rejections as the reviewer's, only in kinds set to review", async () => {
        answer = async () => [
            { itemId: "p1", decision: "approve" },
            { itemId: "p2", decision: "reject", reasonId: "spam" },
        ];
        await runReviewRound();
        expect(handed).toEqual([["p1", "p2"]]);
        expect(decided).toEqual([
            { provider: "forum-post", ids: ["p1"], state: "APPROVED", reasonId: null, reviewer: "ai-moderation" },
            { provider: "forum-post", ids: ["p2"], state: "REJECTED", reasonId: "spam", reviewer: "ai-moderation" },
        ]);
        expect(kinds["blog-comment"][0].state).toBe("PENDING");
    });

    it("leaves a rejection waiting when its reason is not one the site offers, and does not ask again", async () => {
        answer = async () => [
            { itemId: "p1", decision: "reject", reasonId: "made-up" },
            { itemId: "p2", decision: "reject" },
        ];
        await runReviewRound();
        expect(decided).toEqual([]);
        expect(kinds["forum-post"].map((i) => i.state)).toEqual(["PENDING", "PENDING"]);

        await runReviewRound();
        expect(handed).toHaveLength(1);
    });

    it("ignores an answer about an item it was not handed", async () => {
        kinds["forum-post"] = [post("p1")];
        kinds["blog-comment"] = [post("c1")];
        answer = async () => [{ itemId: "c1", decision: "approve" }];
        await runReviewRound();
        expect(decided).toEqual([]);
        expect(kinds["blog-comment"][0].state).toBe("PENDING");
    });

    it("hands an edited item over again, since the text it judged is gone", async () => {
        await runReviewRound();
        await runReviewRound();
        expect(handed).toEqual([["p1", "p2"]]);

        kinds["forum-post"][0].body = "edited";
        await runReviewRound();
        expect(handed).toEqual([["p1", "p2"], ["p1"]]);
    });

    it("counts a failed call against each item and leaves it for a person once out of attempts", async () => {
        capacity.maxAttempts = 2;
        answer = async () => { throw new Error("provider down"); };
        await runReviewRound();
        await runReviewRound();
        await runReviewRound();
        expect(handed).toHaveLength(2);
        expect(decided).toEqual([]);
        expect(reviewRows.map((r) => [r.itemId, r.attempts, r.settled])).toEqual([["p1", 2, false], ["p2", 2, false]]);
    });

    it("counts an attempt for an item the answer skipped", async () => {
        answer = async () => [{ itemId: "p1", decision: "leave" }];
        await runReviewRound();
        expect(reviewRows.find((r) => r.itemId === "p2")).toMatchObject({ attempts: 1, settled: false });
        await runReviewRound();
        expect(handed).toEqual([["p1", "p2"], ["p2"]]);
    });

    it("never hands over an item whose author asked for a person", async () => {
        humanOnly = [{ provider: "forum-post", itemId: "p1" }];
        await runReviewRound();
        expect(handed).toEqual([["p2"]]);
    });

    it("keeps what a moderator decided while the reviewer was thinking", async () => {
        answer = async (items) => {
            kinds["forum-post"][0].state = "APPROVED";
            return items.map((i) => ({ itemId: i.itemId, decision: "reject" as const, reasonId: "spam" }));
        };
        await runReviewRound();
        expect(decided).toEqual([{ provider: "forum-post", ids: ["p2"], state: "REJECTED", reasonId: "spam", reviewer: "ai-moderation" }]);
        expect(kinds["forum-post"][0].state).toBe("APPROVED");
    });

    it("takes no more than the reviewer asked for, in batches of its size, from the kinds it reviews", async () => {
        kinds["forum-post"] = Array.from({ length: 7 }, (_, n) => post(`p${n + 1}`));
        modes = { forum_posts: "review", blog_comments: "review" };
        capacity = { perRun: 6, batchSize: 4, maxAttempts: 3, kinds: ["forum-post"] };
        await runReviewRound();
        expect(handed).toEqual([["p1", "p2", "p3", "p4"], ["p5", "p6"]]);
    });

    it("hands over nothing from a kind whose module cannot read its items", async () => {
        modes = { old_kind: "review" };
        await runReviewRound();
        expect(handed).toEqual([]);
    });

    it("hands over nothing when no reviewer is installed, or its module is switched off", async () => {
        reviewers = [];
        await runReviewRound();
        reviewers = [{ id: "ai-moderation", name: "AI moderation", module: "ai-moderation" }];
        moduleStates = { "ai-moderation": false };
        await runReviewRound();
        expect(handed).toEqual([]);
    });

    it("hands over nothing when the module states cannot be read", async () => {
        moduleStates = new Error("database down");
        await runReviewRound();
        expect(handed).toEqual([]);
    });

    it("hands over nothing when two reviewers are on, since nobody chose between them", async () => {
        reviewers.push({ id: "other-reviewer", name: "Other", module: "other-reviewer" });
        await runReviewRound();
        expect(handed).toEqual([]);
    });

    it("does not start while a round is still running", async () => {
        let release: () => void = () => {};
        answer = (items) => new Promise((resolve) => {
            release = () => resolve(items.map((i) => ({ itemId: i.itemId, decision: "leave" as const })));
        });
        const first = runReviewRound();
        await vi.waitFor(() => expect(handed).toHaveLength(1));
        await runReviewRound();
        release();
        await first;
        expect(handed).toHaveLength(1);
    });
});
