import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Whether what a stranger wrote is published at once or waits for a
 * moderator is one setting, read by one function every module calls.
 */

let stored: { value: unknown } | null = null;

vi.mock("@/core/lib/db", () => ({
    prisma: {
        setting: {
            findUnique: async ({ where }: { where: { key: string } }) => (where.key === "moderation" ? stored : null),
        },
    },
}));

const { moderationStateFor } = await import("@/core/lib/moderation-mode");

describe("moderationStateFor", () => {
    beforeEach(() => {
        stored = null;
    });

    it("holds a post for a moderator when its kind is set to manual", async () => {
        stored = { value: { forum_posts: "manual" } };
        expect(await moderationStateFor("forum_posts")).toBe("PENDING");
    });

    it("publishes a post whose kind is set to auto", async () => {
        stored = { value: { forum_posts: "auto" } };
        expect(await moderationStateFor("forum_posts")).toBe("APPROVED");
    });

    it("publishes a post whose kind was never set", async () => {
        stored = { value: { blog_comments: "manual" } };
        expect(await moderationStateFor("forum_posts")).toBe("APPROVED");
    });

    it("publishes when the site has no moderation setting at all", async () => {
        expect(await moderationStateFor("forum_posts")).toBe("APPROVED");
    });

    it("publishes when the stored value is not a mode it knows", async () => {
        stored = { value: { forum_posts: 42 } };
        expect(await moderationStateFor("forum_posts")).toBe("APPROVED");
        stored = { value: "manual" };
        expect(await moderationStateFor("forum_posts")).toBe("APPROVED");
    });
});
