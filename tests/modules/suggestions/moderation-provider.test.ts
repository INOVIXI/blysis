// @vitest-environment node
/**
 * The suggestion board's two moderation providers can show what they
 * rejected and hand over an item whole.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { moderatedTable, type ModeratedRow } from "../../stubs/moderated-rows";

const LONG = "z".repeat(450);
const author = { id: "u1", username: "sam" };
const suggestion = { id: "s9", title: "Add a parkour map" };

let suggestions = moderatedTable([]);
let comments = moderatedTable([]);

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        get suggestion() { return suggestions; },
        get suggestionComment() { return comments; },
    },
}));

const suggestionProvider = (await import("@/modules/suggestions/moderation/provider")).default;
const commentProvider = (await import("@/modules/suggestions/moderation/comments")).default;

function row(id: string, state: string, minutes: number, extra: Partial<ModeratedRow> = {}): ModeratedRow {
    const at = new Date(Date.UTC(2026, 10, 13, 12, minutes));
    return { id, authorId: "u1", author, content: `${id} ${LONG}`, moderationState: state, createdAt: at, updatedAt: at, ...extra };
}

beforeEach(() => {
    suggestions = moderatedTable([
        row("s1", "REJECTED", 1, { title: "More slots" }),
        row("s2", "PENDING", 2, { title: "A new world" }),
    ]);
    comments = moderatedTable([
        row("k1", "PENDING", 1, { suggestion }),
        row("k2", "REJECTED", 2, { suggestion }),
    ]);
});

describe("suggestions", () => {
    it("list only what was rejected", async () => {
        const { items, total } = await suggestionProvider.listRejected!(0, 10);
        expect(total).toBe(1);
        expect(items[0]).toMatchObject({ id: "s1", title: "More slots", href: "/suggestions/s1" });
    });

    it("hand over a suggestion whole", async () => {
        const [item] = await suggestionProvider.read!(["s2"]);
        expect(item).toMatchObject({ id: "s2", authorId: "u1", title: "A new world", state: "PENDING", href: "/suggestions/s2" });
        expect(item.body).toBe(`s2 ${LONG}`);
    });
});

describe("suggestion comments", () => {
    it("list only what was rejected, under the suggestion they answer", async () => {
        const { items } = await commentProvider.listRejected!(0, 10);
        expect(items.map((i) => i.id)).toEqual(["k2"]);
        expect(items[0]).toMatchObject({ title: "Add a parkour map", href: "/suggestions/s9" });
    });

    it("hand over a comment whole", async () => {
        const [item] = await commentProvider.read!(["k1"]);
        expect(item).toMatchObject({ id: "k1", authorId: "u1", state: "PENDING", href: "/suggestions/s9" });
        expect(item.body.length).toBeGreaterThan(200);
    });

    it("put a rejected comment back in the queue", async () => {
        expect(await commentProvider.bulkUpdate(["k2"], "PENDING")).toBe(1);
        expect(comments.rows.find((r) => r.id === "k2")?.moderationState).toBe("PENDING");
    });
});
