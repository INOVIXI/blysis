// @vitest-environment node
/**
 * A support assistant draws on the help articles that share words with a
 * ticket, and only on those a visitor can read.
 *
 * The articles are offered only when the operator switched this source on,
 * the ones sharing the most words come first, and each is handed over in the
 * member's language with a link the member can open.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Article { id: string; slug: string; title: string; content: string; isActive: boolean }

let articles: Article[] = [];
const asked: Record<string, unknown>[] = [];

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        helpArticle: {
            findMany: vi.fn(async ({ where }: { where: { isActive: boolean } }) => {
                asked.push(where);
                return articles.filter((a) => a.isActive === where.isActive);
            }),
        },
    },
    textContains: (fields: string[], term: string) => fields.map((field) => ({ [field]: { contains: term, mode: "insensitive" } })),
    translateContent: async (_p: unknown, _o: unknown, rows: Article[], _f: unknown, locale: string) =>
        rows.map((row) => (locale === "tr" ? { ...row, title: `TR ${row.title}` } : row)),
    moduleTranslator: async () => (key: string) => `t:${key}`,
}));

const helpArticles = (await import("@/modules/help-center/hooks/knowledge")).default;
const articlesSource = (await import("@/modules/help-center/hooks/knowledge-source")).default;

const question = { terms: ["refund", "rank"], locale: "tr", limit: 1, sources: ["help-center.articles"] };

beforeEach(() => {
    asked.length = 0;
    articles = [
        { id: "a1", slug: "ranks", title: "Ranks", content: "How a rank is given", isActive: true },
        { id: "a2", slug: "refunds", title: "Refunds", content: "A refund for a rank you did not get", isActive: true },
        { id: "a3", slug: "old", title: "Old refund rank page", content: "refund rank refund rank", isActive: false },
    ];
});

describe("the help an assistant is handed", () => {
    it("is the article sharing the most words, in the member's language, with its link", async () => {
        const found = await helpArticles([], question);
        expect(found).toEqual([
            { source: "help-center.articles", title: "TR Refunds", text: "A refund for a rank you did not get", href: "/help/refunds" },
        ]);
    });

    it("never includes an article that was taken down", async () => {
        const found = await helpArticles([], { ...question, limit: 5 });
        expect(found.map((piece) => piece.href)).not.toContain("/help/old");
        expect(asked[0]).toMatchObject({ isActive: true });
    });

    it("adds to what other sources found and asks nothing when it is not switched on", async () => {
        const earlier = [{ source: "other", title: "x", text: "y" }];
        expect(await helpArticles(earlier, { ...question, sources: ["other"] })).toBe(earlier);
        expect(asked).toHaveLength(0);
        expect((await helpArticles(earlier, question))[0]).toBe(earlier[0]);
    });

    it("names itself for the settings screen", async () => {
        expect(await articlesSource([], { locale: "en" })).toEqual([{ id: "help-center.articles", label: "t:knowledge_articles" }]);
    });
});
