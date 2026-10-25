/**
 * A profile counts, lists and names only what a stranger may read.
 *
 * Its counts were every row with the member's name on it, its list held them
 * to the moderation state alone, and its newest topics to nothing. What a
 * stranger may read of another module is that module's rule, so each read
 * asks `profile.contentWhere` for it, and the three cannot disagree: a
 * profile that says "2 topics" opens a list of two.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
    topics: [] as Record<string, unknown>[],
    /** What the forum would answer; `undefined` leaves the profile's rule as it is. */
    narrow: undefined as Record<string, unknown> | null | undefined,
}));

vi.mock("@/core/sdk", () => ({
    applyFiltersAsync: async (hook: string, initial: unknown) =>
        hook === "profile.contentWhere" && db.narrow !== undefined
            ? (db.narrow === null ? null : { AND: [initial, db.narrow] })
            : initial,
}));

vi.mock("@/core/sdk/server", async () => {
    const { matches: match } = await import("../game-connect/fake-prisma");
    const read = (args: { where?: Row }) => db.topics.filter((t) => match(t, args.where));
    return {
        pageParams: () => ({ page: 1, limit: 20, skip: 0, take: 20 }),
        prisma: {
            user: {
                findFirst: async () => ({ id: "u1", username: "Mavikaplan", avatar: null, createdAt: new Date(), role: null }),
            },
            forumTopic: {
                count: async (args: { where?: Row }) => read(args).length,
                findMany: async (args: { where?: Row; take?: number }) => read(args).slice(0, args.take ?? Infinity),
            },
        },
    };
});
vi.mock("@/modules/member-profiles/lib/read-linked-accounts", () => ({ readLinkedAccounts: async () => [] }));

const { readMember } = await import("@/modules/member-profiles/lib/read-member");
const { GET } = await import("@/modules/member-profiles/api/[username]/content/route");

const topic = (id: string, extra: Row = {}): Row => ({
    id, title: id, slug: id, content: "", authorId: "u1", categoryId: "open", moderationState: "APPROVED", createdAt: new Date(), ...extra,
});

async function listed() {
    const response = await GET(new NextRequest("http://site.test/api/v1/members/Mavikaplan/content?kind=topics"), {
        params: Promise.resolve({ username: "Mavikaplan" }),
    });
    const body = await response.json() as { items: { id: string }[]; pagination: { total: number } };
    return { ids: body.items.map((item) => item.id), total: body.pagination.total };
}

beforeEach(() => {
    db.topics = [topic("open"), topic("pending", { moderationState: "PENDING" }), topic("staff-only", { categoryId: "staff" })];
    db.narrow = undefined;
});

describe("a profile", () => {
    it("counts, lists and names the same topics", async () => {
        db.narrow = { categoryId: { in: ["open"] } };
        const member = await readMember("Mavikaplan");
        expect(member?._count.topics).toBe(1);
        expect(member?.recentTopics.map((t) => t.id)).toEqual(["open"]);
        expect(await listed()).toEqual({ ids: ["open"], total: 1 });
    });

    it("holds every read to the moderation state where no module narrows it", async () => {
        const member = await readMember("Mavikaplan");
        expect(member?._count.topics).toBe(2);
        expect(member?.recentTopics.map((t) => t.id)).toEqual(["open", "staff-only"]);
    });

    it("says nothing of a kind a stranger may read none of", async () => {
        db.narrow = null;
        const member = await readMember("Mavikaplan");
        expect(member?._count).not.toHaveProperty("topics");
        expect(member?.recentTopics).toEqual([]);
        expect(await listed()).toEqual({ ids: [], total: 0 });
    });

    it("reads only the member's own", async () => {
        db.topics.push(topic("theirs", { authorId: "u2" }));
        expect((await listed()).ids).not.toContain("theirs");
    });
});
