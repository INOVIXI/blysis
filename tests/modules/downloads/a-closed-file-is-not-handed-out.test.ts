// @vitest-environment node
/**
 * A file an operator closed is not handed out by its address.
 *
 * Closing a download took it off the list and off its guide page, but the
 * endpoint that counts a download and returns the file's address looked the
 * row up by id alone. Anybody who still held the link - a bookmark, a post
 * in a forum - went on getting the file, the counter went on rising and the
 * downloaded hook went on firing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
    row: null as { id: string; title: string; fileName: string; fileUrl: string; isActive: boolean } | null,
    user: null as { id: string; role: string } | null,
    admin: false,
};
const counted = vi.fn(async () => ({}));
const fired = vi.fn(async () => undefined);

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        download: {
            findUnique: async () => state.row,
            findFirst: async ({ where }: { where: { id: string; isActive?: boolean } }) =>
                state.row && (where.isActive === undefined || state.row.isActive === where.isActive) ? state.row : null,
            update: (...args: unknown[]) => counted(...(args as [])),
        },
        resourcePermission: { count: async () => 0 },
        activityFeedItem: { create: async () => ({}) },
    },
    isAdmin: async () => state.admin,
    rateLimitForRoleAsync: async () => true,
    getClientIP: () => "203.0.113.1",
    readJsonBody: async (request: Request) => request.json(),
    contentTranslationsInput: () => ({ ok: true, value: null }),
    saveContentTranslations: async () => undefined,
    deleteContentTranslations: async () => undefined,
}));
vi.mock("@/core/sdk", () => ({ doActionAsync: fired }));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => (state.user ? { user: state.user } : null) }));

const { GET } = await import("@/modules/downloads/api/[id]/route");
const { NextRequest } = await import("next/server");

function download() {
    return GET(new NextRequest("http://x/api/v1/downloads/d1"), { params: Promise.resolve({ id: "d1" }) });
}

beforeEach(() => {
    state.row = { id: "d1", title: "Pack", fileName: "pack.zip", fileUrl: "https://cdn.example.com/pack.zip", isActive: true };
    state.user = null;
    state.admin = false;
    counted.mockClear();
    fired.mockClear();
});

describe("downloading by address", () => {
    it("hands out a file that is open", async () => {
        expect((await download()).status).toBe(200);
        expect(counted).toHaveBeenCalledTimes(1);
    });

    it("does not hand out a closed one, count it or tell anybody it happened", async () => {
        state.row!.isActive = false;
        state.user = { id: "m1", role: "member" };
        expect((await download()).status).toBe(404);
        expect(counted).not.toHaveBeenCalled();
        expect(fired).not.toHaveBeenCalled();
    });

    it("still lets an administrator fetch a closed file", async () => {
        state.row!.isActive = false;
        state.user = { id: "a1", role: "admin" };
        state.admin = true;
        expect((await download()).status).toBe(200);
    });
});
