// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { matches } from "../game-connect/fake-prisma";

/**
 * A member's profile shows only the forum a visitor could open.
 *
 * The profile counts a member's topics and replies, lists them with their
 * opening words and names the newest five, and it read all of that straight
 * from the forum's tables, held only to the moderation state. A topic in a
 * section only the staff may open, and every topic on a forum its operator
 * had closed to visitors, was named on a page anyone can load. The forum is
 * the one module that knows those rules, so the profile asks it to narrow
 * what it reads.
 */

type Row = Record<string, unknown>;

const db: { rules: Row[]; allowGuestView: boolean } = { rules: [], allowGuestView: true };

vi.mock("@/core/sdk/server", () => ({
    moduleSettings: async () => ({ allowGuestView: db.allowGuestView }),
    prisma: {
        forumCategory: {
            findMany: async () => [
                { id: "open", parentId: null },
                { id: "staff", parentId: null },
            ],
        },
        forumCategoryPermission: { findMany: async () => db.rules },
    },
}));

const contentWhere = (await import("@/modules/forum/hooks/profile-content-where")).default;

/** What the profile asks with: its own rule for the kind. */
const APPROVED = { moderationState: "APPROVED" };

/**
 * `matches`, and a reply's `topic` read as the relation it is: the shared
 * fake compares fields and would call any relation filter a match.
 */
function readable(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, condition]) => {
        if (key === "AND") return (condition as Row[]).every((w) => readable(row, w));
        if (key === "topic") return readable(row.topic as Row, condition as Row);
        return matches(row, { [key]: condition });
    });
}

async function visible(kind: string, rows: Row[]) {
    const where = await contentWhere(APPROVED, { kind });
    return where === null ? null : rows.filter((row) => readable(row, where)).map((row) => row.id);
}

const topic = (id: string, extra: Row = {}): Row => ({ id, categoryId: "open", moderationState: "APPROVED", ...extra });
const reply = (id: string, onTopic: Row, extra: Row = {}): Row => ({ id, moderationState: "APPROVED", topic: onTopic, ...extra });

beforeEach(() => {
    db.rules = [];
    db.allowGuestView = true;
});

describe("what a profile may show of the forum", () => {
    it("keeps the profile's own rule", async () => {
        expect(await visible("topics", [topic("approved"), topic("pending", { moderationState: "PENDING" })])).toEqual(["approved"]);
    });

    it("leaves out a section a visitor may not open", async () => {
        db.rules = [{ categoryId: "staff", roleId: "staff-role", canView: true, canPost: true, canReply: true }];
        expect(await visible("topics", [topic("open"), topic("staff-only", { categoryId: "staff" })])).toEqual(["open"]);
        expect(await visible("posts", [reply("in-open", topic("t1")), reply("in-staff", topic("t2", { categoryId: "staff" }))]))
            .toEqual(["in-open"]);
    });

    it("leaves out a reply to a topic nobody may read yet", async () => {
        expect(await visible("posts", [reply("answered", topic("t1")), reply("early", topic("t2", { moderationState: "PENDING" }))]))
            .toEqual(["answered"]);
    });

    it("is nothing at all on a forum closed to visitors", async () => {
        db.allowGuestView = false;
        expect(await contentWhere(APPROVED, { kind: "topics" })).toBeNull();
        expect(await contentWhere(APPROVED, { kind: "posts" })).toBeNull();
    });

    it("leaves every other kind to its own module", async () => {
        db.allowGuestView = false;
        expect(await contentWhere(APPROVED, { kind: "comments" })).toEqual(APPROVED);
        expect(await contentWhere(null, { kind: "topics" })).toBeNull();
    });
});
