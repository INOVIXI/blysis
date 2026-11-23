// @vitest-environment node
/**
 * A topic's view count goes up when somebody opens the topic, not when the
 * open page asks for more of it.
 *
 * The page counts a view when it renders. The topic endpoint counted one as
 * well, and the page calls it to turn the page of replies and to reload after
 * somebody posts, so one reader paging through a long thread counted as a
 * crowd, and the count stopped meaning how many people had read it.
 */
import { describe, it, expect, vi } from "vitest";

const counted = vi.fn(async () => undefined);

vi.mock("@/modules/forum/lib/read-topic", () => ({
    readTopic: async () => ({ topic: { id: "t1" }, postsPage: 2, postsPerPage: 20, postsTotal: 40, postsPages: 2 }),
    countTopicView: counted,
}));
vi.mock("@/core/sdk/server", () => ({
    pageParams: () => ({ page: 2 }),
    refuseSilenced: async () => null,
    isRestrictedFrom: async () => false,
    moderationStateFor: async () => "APPROVED",
    hasPermission: async () => false,
    prisma: {},
    rateLimitForRole: async () => ({ success: true }),
    readJsonBody: async (request: Request) => request.json(),
}));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => null }));

const { GET } = await import("@/modules/forum/api/topics/[id]/route");
const { NextRequest } = await import("next/server");

describe("asking the topic endpoint for a page of replies", () => {
    it("answers without counting another view", async () => {
        const res = await GET(new NextRequest("http://x/api/v1/forum/topics/t1?postsPage=2"), {
            params: Promise.resolve({ id: "t1" }),
        });
        expect(res.status).toBe(200);
        expect(counted).not.toHaveBeenCalled();
    });
});
