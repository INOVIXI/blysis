// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { matches } from "../game-connect/fake-prisma";

/**
 * A member's profile names only the topics a visitor could open.
 *
 * The profile read a member's newest topics straight from the table, so a
 * topic still waiting for a moderator, one a moderator turned down, and one
 * in a section only the staff may open were listed by title on a public
 * page, and on a forum its operator had closed to visitors. The forum is the
 * one module that knows those rules, so the profile asks it.
 */

type Row = Record<string, unknown>;

const db: { topics: Row[]; rules: Row[]; allowGuestView: boolean } = { topics: [], rules: [], allowGuestView: true };

vi.mock("@/core/sdk/server", () => ({
    moduleSettings: async () => ({ allowGuestView: db.allowGuestView }),
    prisma: {
        forumTopic: {
            findMany: async (args: { where?: Row; take?: number }) =>
                db.topics.filter((t) => matches(t, args.where)).slice(0, args.take ?? Infinity)
                    .map(({ id, title, slug, createdAt }) => ({ id, title, slug, createdAt })),
        },
        forumCategory: {
            findMany: async () => [
                { id: "open", parentId: null },
                { id: "staff", parentId: null },
            ],
        },
        forumCategoryPermission: { findMany: async () => db.rules },
    },
}));

const recentTopics = (await import("@/modules/forum/hooks/profile-recent-topics")).default;

const topic = (id: string, extra: Row = {}): Row => ({
    id, title: id, slug: id, authorId: "member", categoryId: "open", moderationState: "APPROVED", createdAt: new Date(), ...extra,
});

async function titles() {
    return (await recentTopics([], { userId: "member" })).map((t) => t.title);
}

beforeEach(() => {
    db.topics = [];
    db.rules = [];
    db.allowGuestView = true;
});

describe("a member's newest topics on their profile", () => {
    it("are the member's own", async () => {
        db.topics = [topic("mine"), topic("theirs", { authorId: "someone-else" })];
        expect(await titles()).toEqual(["mine"]);
    });

    it("leave out what is waiting for a moderator or was turned down", async () => {
        db.topics = [topic("approved"), topic("pending", { moderationState: "PENDING" }), topic("rejected", { moderationState: "REJECTED" })];
        expect(await titles()).toEqual(["approved"]);
    });

    it("leave out a section a visitor may not open", async () => {
        db.rules = [{ categoryId: "staff", roleId: "staff-role", canView: true, canPost: true, canReply: true }];
        db.topics = [topic("open"), topic("staff-only", { categoryId: "staff" })];
        expect(await titles()).toEqual(["open"]);
    });

    it("are none on a forum closed to visitors", async () => {
        db.allowGuestView = false;
        db.topics = [topic("open")];
        expect(await titles()).toEqual([]);
    });
});
