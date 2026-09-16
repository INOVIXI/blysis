// @vitest-environment node
/**
 * A suggestion carries a discussion, and the discussion has the same rules
 * the board has.
 *
 * The board counted votes and nothing else, so it answered "how many people
 * want this" and never "what do they want out of it" - which is the half an
 * operator needs before building anything. Comments are that half.
 *
 * Three things had to hold before they could be public:
 *
 * A reply is held behind the same switch as the suggestion it sits under. An
 * operator who reviews suggestions has not asked to let the replies through
 * unread, and a moderation queue that lists one and not the other is a queue
 * somebody will trust by mistake.
 *
 * A pending reply is visible to its author and to a moderator, and to nobody
 * else. Hiding it from its own author is how a person posts the same thing
 * three times.
 *
 * And the list has a ceiling. A discussion is readable by anyone and grows
 * with every reply, so reading all of it is a query with no limit - the shape
 * that made four other endpoints in this repository slow before anyone
 * noticed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row { id: string; moderationState: string; authorId: string | null }

let session: { user: { id: string; role?: string } } | null = null;
let admin = false;
let moderationMode: "auto" | "manual" = "auto";
let rows: Row[] = [];
let lastFindArgs: { where?: Record<string, unknown>; take?: number } = {};
const created: Record<string, unknown>[] = [];

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        suggestionComment: {
            findMany: async (args: { where?: Record<string, unknown>; take?: number }) => {
                lastFindArgs = args;
                return rows;
            },
            create: async ({ data }: { data: Record<string, unknown> }) => {
                created.push(data);
                return { id: "c-new", ...data, author: { id: "u1", username: "aeryn", avatar: null } };
            },
        },
        suggestion: {
            findFirst: async () => ({ id: "s1", title: "Add an /afk command" }),
        },
        setting: {
            findUnique: async () => ({ value: { suggestions: moderationMode } }),
        },
        activityFeedItem: { create: async () => ({}) },
    },
    isAdmin: async () => admin,
    hasPermission: async () => admin,
    rateLimitForRole: async () => ({ success: true }),
    readJsonBody: async (request: Request) => request.json(),
    sanitizeHtml: (html: string) => html,
    apiSuccess: (data: unknown, status = 200) =>
        new Response(JSON.stringify({ ok: true, data }), { status, headers: { "content-type": "application/json" } }),
    apiError: (error: string, status = 400, options: { code?: string } = {}) =>
        new Response(JSON.stringify({ ok: false, error, code: options.code }), { status }),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => session }));

const { GET, POST } = await import("@/modules/suggestions/api/[id]/comments/route");

const params = { params: Promise.resolve({ id: "s1" }) };
const read = (url = "http://x/api/v1/suggestions/s1/comments") =>
    GET(new Request(url) as never, params);
const write = (content: string) =>
    POST(new Request("http://x/api/v1/suggestions/s1/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
    }) as never, params);

beforeEach(() => {
    session = null;
    admin = false;
    moderationMode = "auto";
    rows = [];
    created.length = 0;
    lastFindArgs = {};
});

describe("reading a discussion", () => {
    it("shows a signed-out reader the approved replies and nothing else", async () => {
        await read();
        expect(lastFindArgs.where).toMatchObject({ suggestionId: "s1", moderationState: "APPROVED" });
    });

    it("shows a reader their own reply while it waits", async () => {
        // Hiding it from its own author is how somebody posts it three times.
        session = { user: { id: "u1" } };
        await read();
        expect(lastFindArgs.where).toMatchObject({
            OR: [{ moderationState: "APPROVED" }, { authorId: "u1" }],
        });
    });

    it("shows a moderator everything, because that is what the queue reads", async () => {
        session = { user: { id: "mod" } };
        admin = true;
        await read();
        expect(lastFindArgs.where).toEqual({ suggestionId: "s1" });
    });

    it("stops at a ceiling and says it stopped", async () => {
        rows = Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, moderationState: "APPROVED", authorId: null }));
        const body = await (await read("http://x/api/v1/suggestions/s1/comments?limit=3")).json();
        expect(lastFindArgs.take).toBe(4);
        expect(body.data.comments).toHaveLength(3);
        expect(body.data.truncated).toBe(true);
    });

    it("refuses a ceiling somebody asked to remove", async () => {
        await read("http://x/api/v1/suggestions/s1/comments?limit=100000");
        expect(lastFindArgs.take).toBe(201);
    });
});

describe("writing a reply", () => {
    it("is for somebody with an account", async () => {
        expect((await write("Anything")).status).toBe(401);
    });

    it("goes straight up when the board is not moderated", async () => {
        session = { user: { id: "u1" } };
        expect((await write("Sounds good to me.")).status).toBe(201);
        expect(created[0]).toMatchObject({ moderationState: "APPROVED", suggestionId: "s1", authorId: "u1" });
    });

    it("waits when the board is, because a reply is part of the board", async () => {
        session = { user: { id: "u1" } };
        moderationMode = "manual";
        await write("Sounds good to me.");
        expect(created[0]).toMatchObject({ moderationState: "PENDING" });
    });

    it("refuses an empty one", async () => {
        session = { user: { id: "u1" } };
        expect((await write(" ")).status).toBe(400);
        expect(created).toHaveLength(0);
    });

    it("refuses one with no ceiling on it", async () => {
        session = { user: { id: "u1" } };
        expect((await write("x".repeat(4_001))).status).toBe(400);
        expect(created).toHaveLength(0);
    });
});
