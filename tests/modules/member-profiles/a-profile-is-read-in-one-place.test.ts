/**
 * A member's profile is read in one place, by the page and the endpoint.
 *
 * The profile page fetched `/api/v1/members/<name>` after it had loaded, so
 * not a word of a profile was in the HTML the server sent. The page reads it
 * on the server now, through the same function the endpoint calls, so the
 * two cannot drift: what a profile counts is still only what this install
 * can count, and an unknown name is nobody rather than an empty profile.
 */
import { describe, it, expect, vi } from "vitest";

const users = [{
    id: "u1",
    username: "Mavikaplan",
    avatar: null,
    createdAt: new Date("2026-03-04T12:00:00Z"),
    role: { id: "r1", name: "diamond", displayName: "Elmas", color: "#3fd2e4", nameCss: null, badgeCss: null },
}];

const prisma = {
    user: {
        findFirst: async ({ where }: { where: { username: { equals: string } } }) =>
            users.find((u) => u.username.toLowerCase() === where.username.equals.toLowerCase()) ?? null,
    },
    // A forum and a store are installed here; a blog and suggestions are not.
    forumTopic: {
        count: async () => 2,
        findMany: async () => [{ id: "t1", title: "Adada uçuş açılmıyor", slug: "adada-ucus", createdAt: new Date("2026-10-21T19:04:00Z") }],
    },
    forumPost: { count: async () => 40 },
    order: { count: async () => 3 },
};

vi.mock("@/core/sdk/server", () => ({ prisma }));
// No module narrows anything here; what one may narrow has a file of its own.
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: async (_hook: string, initial: unknown) => initial }));
vi.mock("@/modules/member-profiles/lib/read-linked-accounts", () => ({
    readLinkedAccounts: async () => [{ provider: "minecraft", username: "Mavikaplan", avatar: null }],
}));

const { readMember } = await import("@/modules/member-profiles/lib/read-member");

describe("a member's profile", () => {
    it("is nobody for a name no member has", async () => {
        expect(await readMember("nobody")).toBeNull();
    });

    it("is found whatever the case of the name", async () => {
        expect((await readMember("mavikaplan"))?.username).toBe("Mavikaplan");
    });

    it("counts only what this install can count", async () => {
        const member = await readMember("Mavikaplan");
        expect(member?._count).toEqual({ orders: 3, topics: 2, posts: 40 });
    });

    it("carries the role, the newest topics and the accounts the member proved", async () => {
        const member = await readMember("Mavikaplan");
        expect(member?.role?.displayName).toBe("Elmas");
        expect(member?.recentTopics.map((t) => t.title)).toEqual(["Adada uçuş açılmıyor"]);
        expect(member?.linkedAccounts).toEqual([{ provider: "minecraft", username: "Mavikaplan", avatar: null }]);
    });
});
