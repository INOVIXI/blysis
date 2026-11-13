// @vitest-environment node
/**
 * What the author of a moderated item is shown about it, and to whom.
 *
 * Only the author: anybody else asking about the item, or asking about one
 * that does not exist, gets the same nothing, so the page cannot be used to
 * learn what somebody else wrote or that a post exists. A kind whose module
 * cannot read its items cannot say who wrote them, so it shows nobody.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const LONG = "w".repeat(900);
let moduleOn = true;

vi.mock("@/core/generated/module-moderation", () => ({
    ModuleModerationProviders: [
        {
            id: "forum-post", label: "Forum posts", module: "forum",
            loader: async () => ({
                default: {
                    count: async () => 0,
                    list: async () => ({ items: [], total: 0 }),
                    bulkUpdate: async () => 0,
                    read: async (ids: string[]) =>
                        ids.includes("p1")
                            ? [{ id: "p1", authorId: "u1", title: "Server rules", body: LONG, state: "REJECTED", href: "/forum/topic/rules" }]
                            : [],
                },
            }),
        },
        {
            id: "old-kind", label: "Old", module: "elsewhere",
            loader: async () => ({ default: { count: async () => 0, list: async () => ({ items: [], total: 0 }), bulkUpdate: async () => 0 } }),
        },
    ],
}));
vi.mock("@/core/lib/module-cache", () => ({ getModuleStates: async () => ({ forum: moduleOn }) }));
vi.mock("@/core/lib/moderation-decisions", () => ({
    latestDecisions: async (_provider: string, ids: string[], locale: string) =>
        new Map(ids.map((id) => [id, { reason: `${locale}:Spam`, note: "moderators only", decidedBy: { id: "m1", username: "mod" }, reviewer: null, decidedAt: new Date("2026-11-13T12:00:00Z") }])),
}));

const { readNotice } = await import("@/core/lib/moderation-notice");

beforeEach(() => {
    moduleOn = true;
});

describe("the author's notice", () => {
    it("tells the author why, in their language", async () => {
        const notice = await readNotice("forum-post", "p1", "u1", "tr");
        expect(notice).toMatchObject({ title: "Server rules", state: "REJECTED", reason: "tr:Spam", href: "/forum/topic/rules" });
        expect(notice?.decidedAt).toBe("2026-11-13T12:00:00.000Z");
    });

    it("quotes a long post only in part", async () => {
        const notice = await readNotice("forum-post", "p1", "u1", "en");
        expect(notice?.excerpt.length).toBeLessThanOrEqual(500);
    });

    it("never carries the moderators' note", async () => {
        const notice = await readNotice("forum-post", "p1", "u1", "en");
        expect(JSON.stringify(notice)).not.toContain("moderators only");
        expect(JSON.stringify(notice)).not.toContain("mod");
    });

    it("shows somebody else nothing", async () => {
        expect(await readNotice("forum-post", "p1", "u2", "en")).toBeNull();
    });

    it("shows nothing for an item that does not exist", async () => {
        expect(await readNotice("forum-post", "nope", "u1", "en")).toBeNull();
    });

    it("shows nothing for a kind whose module cannot read its items", async () => {
        expect(await readNotice("old-kind", "p1", "u1", "en")).toBeNull();
    });

    it("shows nothing for a kind whose module is switched off", async () => {
        moduleOn = false;
        expect(await readNotice("forum-post", "p1", "u1", "en")).toBeNull();
    });

    it("shows nothing for a kind nobody declares", async () => {
        expect(await readNotice("made-up", "p1", "u1", "en")).toBeNull();
    });
});
