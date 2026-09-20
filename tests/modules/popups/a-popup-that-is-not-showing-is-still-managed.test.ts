// @vitest-environment node
/**
 * The screen that manages popups shows every popup.
 *
 * `GET /api/v1/popups` answers one question - "is there something to show
 * this visitor right now?" - and answers it with `isActive: true`, inside its
 * window, `take: 1`. The panel read that same answer. So an operator with
 * three popups saw one row, a popup scheduled for next week was invisible on
 * the only screen that could move it, and one that had ended could not be
 * found to be brought back.
 *
 * Measured by seeding three: the panel listed one.
 *
 * `scope=admin` is the operator's answer, and it is refused to anybody who
 * could not open the screen that asks for it: a popup that has not started is
 * something the site has not said yet.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const found: Record<string, unknown>[] = [];
const queries: Record<string, unknown>[] = [];
const session: { value: { user: { id: string } } | null } = { value: null };
const admin = { value: false };

vi.mock("@/core/sdk/server", () => ({
    isAdmin: async () => admin.value,
    readJsonBody: async () => ({}),
    prisma: {
        popup: {
            findMany: async (args: Record<string, unknown>) => {
                queries.push(args);
                return found;
            },
        },
    },
}));

vi.mock("@/core/sdk/auth", () => ({ auth: async () => session.value }));

async function get(url: string) {
    const { GET } = await import("../../../module-sources/popups/api/route");
    return GET(new Request(url) as never);
}

beforeEach(() => {
    queries.length = 0;
    found.length = 0;
    session.value = null;
    admin.value = false;
    vi.resetModules();
});

describe("what a visitor is shown", () => {
    it("is the one popup that is live right now", async () => {
        await get("https://example.com/api/v1/popups");
        expect(queries[0].take).toBe(1);
        expect(queries[0].where).toMatchObject({ isActive: true });
    });
});

describe("what the operator's screen is shown", () => {
    it("is every popup, whether or not it is showing", async () => {
        session.value = { user: { id: "u1" } };
        admin.value = true;

        const res = await get("https://example.com/api/v1/popups?scope=admin");

        expect(res.status).toBe(200);
        expect(queries[0].where ?? {}).toEqual({});
        expect(queries[0].take).not.toBe(1);
    });

    it("is newest first, so the one just written is at the top", async () => {
        session.value = { user: { id: "u1" } };
        admin.value = true;
        await get("https://example.com/api/v1/popups?scope=admin");
        expect(queries[0].orderBy).toEqual({ createdAt: "desc" });
    });

    it("is refused to a visitor, who would be reading what the site has not said yet", async () => {
        const res = await get("https://example.com/api/v1/popups?scope=admin");
        expect(res.status).toBe(401);
        expect(queries).toHaveLength(0);
    });

    it("is refused to a member who is not an operator", async () => {
        session.value = { user: { id: "u2" } };
        const res = await get("https://example.com/api/v1/popups?scope=admin");
        expect(res.status).toBe(403);
        expect(queries).toHaveLength(0);
    });
});
