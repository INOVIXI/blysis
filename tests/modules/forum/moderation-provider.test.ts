// @vitest-environment node
/**
 * The forum's two moderation providers can show what they rejected and
 * hand over an item whole: the Rejected view lists the first, and the
 * author's page and a reviewing module read the second.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { moderatedTable, type ModeratedRow } from "../../stubs/moderated-rows";

const LONG = "x".repeat(450);
const author = { id: "u1", username: "steve" };
const topic = { id: "t1", title: "Server rules", slug: "server-rules" };

let topics = moderatedTable([]);
let posts = moderatedTable([]);

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        get forumTopic() { return topics; },
        get forumPost() { return posts; },
    },
}));

const topicsProvider = (await import("@/modules/forum/moderation/topics")).default;
const postsProvider = (await import("@/modules/forum/moderation/posts")).default;

function row(id: string, state: string, minutes: number, extra: Partial<ModeratedRow> = {}): ModeratedRow {
    const at = new Date(Date.UTC(2026, 10, 13, 12, minutes));
    return { id, authorId: "u1", author, content: `${id} ${LONG}`, moderationState: state, createdAt: at, updatedAt: at, ...extra };
}

beforeEach(() => {
    topics = moderatedTable([
        row("a", "REJECTED", 1, { title: "First", slug: "first" }),
        row("b", "PENDING", 2, { title: "Second", slug: "second" }),
        row("c", "REJECTED", 3, { title: "Third", slug: "third" }),
        row("d", "APPROVED", 4, { title: "Fourth", slug: "fourth" }),
    ]);
    posts = moderatedTable([
        row("p1", "REJECTED", 1, { topic }),
        row("p2", "PENDING", 2, { topic, authorId: null, author: null }),
    ]);
});

describe("forum topics", () => {
    it("list only what was rejected, newest first", async () => {
        const { items, total } = await topicsProvider.listRejected!(0, 10);
        expect(total).toBe(2);
        expect(items.map((i) => i.id)).toEqual(["c", "a"]);
        expect(items[0].href).toBe("/forum/topic/third");
    });

    it("hand over a topic whole, with who wrote it and where it stands", async () => {
        const [item] = await topicsProvider.read!(["b"]);
        expect(item).toMatchObject({ id: "b", authorId: "u1", title: "Second", state: "PENDING", href: "/forum/topic/second" });
        expect(item.body).toBe(`b ${LONG}`);
    });

    it("leave out an id they do not hold", async () => {
        expect(await topicsProvider.read!(["b", "nope"])).toHaveLength(1);
    });

    it("put a rejected topic back in the queue", async () => {
        expect(await topicsProvider.bulkUpdate(["a"], "PENDING")).toBe(1);
        expect(topics.rows.find((r) => r.id === "a")?.moderationState).toBe("PENDING");
    });
});

describe("forum replies", () => {
    it("list only what was rejected, under the topic they answer", async () => {
        const { items } = await postsProvider.listRejected!(0, 10);
        expect(items.map((i) => i.id)).toEqual(["p1"]);
        expect(items[0].title).toBe("Server rules");
    });

    it("hand over a reply whole, even when its author is gone", async () => {
        const [item] = await postsProvider.read!(["p2"]);
        expect(item).toMatchObject({ id: "p2", authorId: null, title: "Server rules", state: "PENDING", href: "/forum/topic/server-rules" });
        expect(item.body.length).toBeGreaterThan(200);
    });
});
