// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { matches } from "../game-connect/fake-prisma";

/**
 * The forum's "most active" board counts what a visitor can read.
 *
 * It counted rows of `forumPost`, which are replies: a topic's opening post is
 * the topic's own `content`, so a member who started thirty discussions and
 * answered none was not on the board at all, and a site whose forum was new
 * showed an empty board under a homepage full of topics.
 *
 * It also counted every reply whatever had become of it. A reply waiting in
 * the moderation queue or turned down there still ranked its author, and so
 * did one written in a category this reader may not open - the board is
 * public, and a staff room's traffic is the staff room's business.
 */

type Row = Record<string, unknown>;

const db: { topics: Row[]; posts: Row[]; rules: Row[] } = { topics: [], posts: [], rules: [] };

function groupBy(rows: Row[], args: { where?: Row; take?: number }) {
    const counts = new Map<unknown, number>();
    for (const row of rows) {
        const { topic: topicWhere, ...own } = (args.where ?? {}) as Row;
        if (!matches(row, own)) continue;
        if (topicWhere) {
            const topic = db.topics.find((t) => t.id === row.topicId);
            if (!topic || !matches(topic, topicWhere as Row)) continue;
        }
        counts.set(row.authorId, (counts.get(row.authorId) ?? 0) + 1);
    }
    const grouped = [...counts].map(([authorId, n]) => ({ authorId, _count: n })).sort((a, b) => b._count - a._count);
    return args.take ? grouped.slice(0, args.take) : grouped;
}

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        forumTopic: { groupBy: async (args: { where?: Row }) => groupBy(db.topics, args) },
        forumPost: { groupBy: async (args: { where?: Row }) => groupBy(db.posts, args) },
        forumCategory: {
            findMany: async () => [
                { id: "open", parentId: null },
                { id: "staff", parentId: null },
            ],
        },
        forumCategoryPermission: { findMany: async () => db.rules },
        user: {
            findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
                where.id.in.map((id) => ({ id, username: id, avatar: null })),
        },
    },
}));

const board = (await import("@/modules/forum/hooks/leaderboard-board")).default;

async function rows(limit = 20) {
    const [answer] = await board([], { boardId: "posters", limit });
    return answer.rows.map((r) => [r.username, r.value]);
}

const topic = (id: string, authorId: string, extra: Row = {}): Row => ({
    id, authorId, categoryId: "open", moderationState: "APPROVED", createdAt: new Date(), ...extra,
});
const reply = (topicId: string, authorId: string, extra: Row = {}): Row => ({
    topicId, authorId, moderationState: "APPROVED", createdAt: new Date(), ...extra,
});

beforeEach(() => {
    db.topics = [];
    db.posts = [];
    db.rules = [];
});

describe("the most active are counted by what a visitor can read", () => {
    it("counts the topics a member started as well as their replies", async () => {
        db.topics = [topic("t1", "starter"), topic("t2", "starter"), topic("t3", "starter")];
        db.posts = [reply("t1", "answerer"), reply("t2", "answerer"), reply("t3", "starter")];

        expect(await rows()).toEqual([["starter", 4], ["answerer", 2]]);
    });

    it("leaves out what is waiting for a moderator or was turned down", async () => {
        db.topics = [topic("t1", "a"), topic("t2", "b", { moderationState: "PENDING" })];
        db.posts = [
            reply("t1", "b", { moderationState: "REJECTED" }),
            reply("t2", "a"),
            reply("t1", "a"),
        ];

        expect(await rows()).toEqual([["a", 2]]);
    });

    it("leaves out a category a visitor may not open", async () => {
        // A list that names only the staff role shuts everybody else out, a
        // visitor first: they have no role to be named.
        db.rules = [{ categoryId: "staff", roleId: "staff-role", canView: true, canPost: true, canReply: true }];
        db.topics = [topic("t1", "a"), topic("t2", "staffer", { categoryId: "staff" })];
        db.posts = [reply("t2", "staffer"), reply("t2", "staffer"), reply("t1", "a")];

        expect(await rows()).toEqual([["a", 2]]);
    });

    it("ranks by the total, not by either half", async () => {
        db.topics = [topic("t1", "a"), topic("t2", "b"), topic("t3", "b")];
        db.posts = [reply("t1", "a"), reply("t1", "a"), reply("t1", "c"), reply("t1", "c")];

        expect(await rows(2)).toEqual([["a", 3], ["b", 2]]);
    });
});
