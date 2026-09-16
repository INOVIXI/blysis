// @vitest-environment node
/**
 * A comment belongs to an article a visitor could have read.
 *
 * Every reading door in this module asks the same question - the page, the
 * search provider, the sitemap and the route resolver all narrow to
 * `status: PUBLISHED` with `publishedAt` in the past. The commenting doors did
 * not: creating one looked the article up by id and checked only that a row
 * came back, and listing them narrowed on the comment's own moderation state
 * and never on the article's.
 *
 * The id is a cuid, so this is not something a stranger guesses. The way in is
 * an article that was published and then pulled back to a draft: its id and
 * slug were public while it was up. Afterwards the page says it is gone, and
 * the comment endpoints go on serving and accepting.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { publishedArticle } from "@/modules/blog/lib/visible-article";

const findUnique = vi.fn<(args: { where: Record<string, unknown> }) => Promise<unknown>>();
const findFirst = vi.fn<(args: { where: Record<string, unknown> }) => Promise<unknown>>();
const commentFindMany = vi.fn(async () => [] as unknown[]);
const commentCreate = vi.fn(async () => ({ id: "c1" }));
const settingFindUnique = vi.fn(async () => null);

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        blogArticle: { findUnique: (a: unknown) => findUnique(a as never), findFirst: (a: unknown) => findFirst(a as never) },
        blogComment: { findMany: () => commentFindMany(), create: () => commentCreate() },
        setting: { findUnique: () => settingFindUnique() },
    },
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    isAdmin: async () => false,
    // A reader, holding nothing. The guarantee this file defends is about a
    // draft being invisible, not about who may moderate it.
    hasPermission: async () => false,
    readJsonBody: async (r: Request) => r.json(),
    sanitizeHtml: (v: string) => v,
    rateLimitForRoleAsync: async () => true,
    rateLimitForRole: async () => ({ success: true }),
    getClientIP: () => "203.0.113.1",
    moduleSettings: async () => ({ allowComments: true }),
    getModerationMode: async () => "auto",
    logActivity: async () => undefined,
    doActionAsync: async () => undefined,
}));
vi.mock("@/core/sdk", () => ({ doActionAsync: async () => undefined, applyFiltersAsync: async (_n: string, v: unknown) => v }));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "u1", username: "reader" } }) }));

const { GET, POST } = await import("@/modules/blog/api/comments/route");
const { NextRequest } = await import("next/server");

const PUBLISHED = { id: "a1", status: "PUBLISHED", publishedAt: new Date("2020-01-01") };

beforeEach(() => {
    vi.clearAllMocks();
    commentFindMany.mockResolvedValue([]);
});

/** The article table, answered through the `where` the route actually writes. */
function articleTable(row: { status: string; publishedAt: Date } | null) {
    const answer = async (args: { where: Record<string, unknown> }) => {
        if (!row) return null;
        const w = args.where as { status?: string; publishedAt?: { lte: Date } };
        if (w.status && w.status !== row.status) return null;
        if (w.publishedAt && !(row.publishedAt <= w.publishedAt.lte)) return null;
        return { id: "a1", ...row };
    };
    findUnique.mockImplementation(answer);
    findFirst.mockImplementation(answer);
}

describe("commenting on an article", () => {
    it("is refused when the article is a draft", async () => {
        articleTable({ status: "DRAFT", publishedAt: new Date("2020-01-01") });

        const res = await POST(new NextRequest("http://x/api/v1/blog/comments", {
            method: "POST",
            body: JSON.stringify({ content: "hello there", articleId: "a1" }),
            headers: { "content-type": "application/json" },
        }));

        expect(res.status).toBe(404);
        expect(commentCreate).not.toHaveBeenCalled();
    });

    it("is refused when the article is scheduled for later", async () => {
        articleTable({ status: "PUBLISHED", publishedAt: new Date(Date.now() + 86_400_000) });

        const res = await POST(new NextRequest("http://x/api/v1/blog/comments", {
            method: "POST",
            body: JSON.stringify({ content: "hello there", articleId: "a1" }),
            headers: { "content-type": "application/json" },
        }));

        expect(res.status).toBe(404);
    });

    it("is allowed on an article a visitor could have read", async () => {
        articleTable(PUBLISHED);

        const res = await POST(new NextRequest("http://x/api/v1/blog/comments", {
            method: "POST",
            body: JSON.stringify({ content: "hello there", articleId: "a1" }),
            headers: { "content-type": "application/json" },
        }));

        expect(res.status).toBe(201);
        expect(commentCreate).toHaveBeenCalled();
    });
});

describe("listing the comments on an article", () => {
    it("says nothing for a draft", async () => {
        articleTable({ status: "DRAFT", publishedAt: new Date("2020-01-01") });

        const res = await GET(new NextRequest("http://x/api/v1/blog/comments?articleId=a1"));

        expect(res.status).toBe(404);
        expect(commentFindMany).not.toHaveBeenCalled();
    });

    it("lists them for one that is published", async () => {
        articleTable(PUBLISHED);

        const res = await GET(new NextRequest("http://x/api/v1/blog/comments?articleId=a1"));

        expect(res.status).toBe(200);
        expect(commentFindMany).toHaveBeenCalled();
    });
});

/**
 * The rule the doors share, and the reason it is shared.
 *
 * Six reads spelled it for themselves and did not agree. The API list, the
 * search provider and the sitemap tested three things; the article's own page,
 * the blog listing and the route resolver tested two, leaving out `publishAt` -
 * so the one door that shows the whole article was the loosest of the six. The
 * sitemap's own comment said the page applied that test, which had stopped
 * being true.
 */
describe("what counts as an article a visitor could have read", () => {
    it("is published, already out, and not still waiting on a schedule", () => {
        const where = publishedArticle();

        expect(where.status).toBe("PUBLISHED");
        expect(where.publishedAt.lte.getTime()).toBeLessThanOrEqual(Date.now());
        expect(where.OR).toEqual([
            { publishAt: null },
            { publishAt: { lte: expect.any(Date) } },
        ]);
    });

    it("reads the clock per call, because a schedule arrives with time", () => {
        const first = publishedArticle().publishedAt.lte.getTime();
        const second = publishedArticle().publishedAt.lte.getTime();

        expect(second).toBeGreaterThanOrEqual(first);
    });

    it("is what every door in the module asks, rather than each asking its own", () => {
        const root = path.resolve(import.meta.dirname, "../../..");
        const doors = [
            "module-sources/blog/pages/page.tsx",
            "module-sources/blog/pages/[...params]/page.tsx",
            "module-sources/blog/seo/sitemap.ts",
            "module-sources/blog/lib/article-exists.ts",
            "module-sources/blog/api/comments/route.ts",
        ];
        const spellingItOut: string[] = [];
        for (const door of doors) {
            const source = fs.readFileSync(path.join(root, door), "utf8");
            if (!source.includes("publishedArticle(")) spellingItOut.push(`${door}: does not ask`);
            if (/status: "PUBLISHED"/.test(source)) spellingItOut.push(`${door}: spells it out again`);
        }
        expect(
            spellingItOut,
            "one definition, so a door added later is an import rather than a chance to spell it differently",
        ).toEqual([]);
    });
});
