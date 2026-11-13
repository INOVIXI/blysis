// @vitest-environment node
/**
 * The blog's comment provider can show what it rejected and hand over a
 * comment whole.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { moderatedTable, type ModeratedRow } from "../../stubs/moderated-rows";

const LONG = "y".repeat(450);
const author = { id: "u1", username: "alex" };
const article = { id: "a1", title: "Patch notes", slug: "patch-notes" };

let comments = moderatedTable([]);

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        get blogComment() { return comments; },
    },
}));

const provider = (await import("@/modules/blog/moderation/comments")).default;

function row(id: string, state: string, minutes: number, extra: Partial<ModeratedRow> = {}): ModeratedRow {
    const at = new Date(Date.UTC(2026, 10, 13, 12, minutes));
    return { id, authorId: "u1", author, article, content: `${id} ${LONG}`, moderationState: state, createdAt: at, updatedAt: at, ...extra };
}

beforeEach(() => {
    comments = moderatedTable([
        row("c1", "REJECTED", 1),
        row("c2", "PENDING", 2),
        row("c3", "REJECTED", 3, { article: null }),
    ]);
});

describe("blog comments", () => {
    it("list only what was rejected, newest first", async () => {
        const { items, total } = await provider.listRejected!(0, 10);
        expect(total).toBe(2);
        expect(items.map((i) => i.id)).toEqual(["c3", "c1"]);
        expect(items[1]).toMatchObject({ title: "Patch notes", href: "/blog/patch-notes" });
    });

    it("hand over a comment whole", async () => {
        const [item] = await provider.read!(["c2"]);
        expect(item).toMatchObject({ id: "c2", authorId: "u1", title: "Patch notes", state: "PENDING", href: "/blog/patch-notes" });
        expect(item.body).toBe(`c2 ${LONG}`);
    });

    it("put a rejected comment back in the queue", async () => {
        expect(await provider.bulkUpdate(["c1"], "PENDING")).toBe(1);
        expect(comments.rows.find((r) => r.id === "c1")?.moderationState).toBe("PENDING");
    });
});
