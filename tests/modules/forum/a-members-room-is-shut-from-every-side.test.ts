// @vitest-environment node
/**
 * A forum an operator closed is closed to search as well.
 *
 * `allowGuestView` decides whether the forum is a public shop window or a
 * members' room, and `denyGuestView` enforces it on every forum endpoint - the
 * rule's own comment says why it has to be the server that decides: the pages
 * are client components, so hiding a link would leave the JSON reachable by
 * anyone who typed the URL.
 *
 * Site search was the URL nobody typed. The provider repeated the moderation
 * rule and not this one, and its own comment claimed the general principle:
 * "a search result is a way into the content and not a lesser view of it".
 *
 * Measured against the running server before this was written. With
 * `allowGuestView` false and one approved topic:
 *
 *     GET /api/v1/forum/topics   403  "Sign in to view the forum"
 *     GET /api/v1/search?q=...   200  title, and the excerpt in full
 *
 * The excerpt is the first 140 characters of the topic, so the door beside the
 * closed one handed out the content itself, not merely its existence.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let signedIn = false;
let allowGuestView = false;
const queryRaw = vi.fn(async () => [
    { title: "Secret roadmap discussion", slug: "secret-roadmap", content: "Internal only." },
]);

vi.mock("@/core/sdk/server", async () => {
    // The real SQL, so a provider builds its query as it does on a site.
    const { searchMatches, searchRank } = await import("@/core/lib/search-text");
    return {
        searchMatches,
        searchRank,
        prisma: {
            $queryRaw: (...args: unknown[]) => queryRaw(...(args as [])),
            // Read before the query, to narrow it to the sections this reader may
            // open. Empty here: this file is about the other visibility rule, and
            // a site with no matrix hides nothing.
            forumCategory: { findMany: async () => [] },
            forumCategoryPermission: { findMany: async () => [] },
        },
        log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
        moduleSettings: async () => ({ allowGuestView }),
    };
});
vi.mock("@/core/sdk/auth", () => ({
    auth: async () => (signedIn ? { user: { id: "u1" } } : null),
}));

const search = (await import("@/modules/forum/search/handler")).default;

beforeEach(() => {
    vi.clearAllMocks();
    signedIn = false;
    allowGuestView = false;
    queryRaw.mockResolvedValue([
        { title: "Secret roadmap discussion", slug: "secret-roadmap", content: "Internal only." },
    ]);
});

describe("forum search, when the forum is a members' room", () => {
    it("tells a stranger nothing", async () => {
        expect(await search("roadmap")).toEqual([]);
    });

    it("does not even ask the database", async () => {
        await search("roadmap");
        expect(queryRaw, "a query that cannot be shown is a query worth not running").not.toHaveBeenCalled();
    });

    it("answers a member normally", async () => {
        signedIn = true;
        const results = await search("roadmap");
        expect(results).toHaveLength(1);
        expect(results[0].title).toBe("Secret roadmap discussion");
    });
});

describe("forum search, when the forum is a public shop window", () => {
    beforeEach(() => {
        allowGuestView = true;
    });

    it("answers a stranger", async () => {
        const results = await search("roadmap");
        expect(results).toHaveLength(1);
        expect(results[0].href).toContain("secret-roadmap");
    });

    it("still says nothing for a query too short to mean anything", async () => {
        expect(await search("a")).toEqual([]);
        expect(queryRaw).not.toHaveBeenCalled();
    });
});
