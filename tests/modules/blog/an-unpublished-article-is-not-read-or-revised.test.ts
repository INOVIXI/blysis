// @vitest-environment node
/**
 * The article endpoint answers a reader only with what was published, and a
 * refused edit leaves no trace in the article's history.
 *
 * Every other door reads through `publishedArticle()`; this one tested only a
 * future `publishAt`, so a draft, an archived article or one pulled back from
 * publication came back whole - title, body, author, comments - to anybody
 * who counted through the article numbers. And the edit recorded a revision
 * before it read the body, so every edit it then refused added a copy of the
 * article to its history.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
    id: string;
    number: number;
    slug: string;
    title: string;
    authorId: string;
    status: string;
    publishedAt: Date | null;
    publishAt: Date | null;
}

const state = {
    row: null as Row | null,
    user: null as { id: string } | null,
    may: new Set<string>(),
};
const recordRevision = vi.fn(async () => undefined);
const update = vi.fn(async () => ({ id: "a1" }));

vi.mock("@/core/sdk/server", () => ({
    prisma: {
        blogArticle: {
            findFirst: async () => state.row,
            findUnique: async () => state.row,
            update: (...args: unknown[]) => update(...(args as [])),
        },
        $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
            work({ blogArticle: { update: (...args: unknown[]) => update(...(args as [])) } }),
    },
    hasPermission: async (_user: string, permission: string) => state.may.has(permission),
    readJsonBody: async (request: Request) => request.json(),
    recordRevision,
    attachContentTranslations: async (_p: unknown, _t: unknown, rows: unknown[]) => rows,
    contentTranslationsInput: () => ({ ok: true, value: null }),
    saveContentTranslations: async () => undefined,
    deleteContentTranslations: async () => undefined,
}));
vi.mock("@/core/sdk", () => ({ generateSlug: (v: string) => v, doActionAsync: async () => undefined }));
vi.mock("@/core/sdk/auth", () => ({ auth: async () => (state.user ? { user: state.user } : null) }));
vi.mock("@/modules/blog/lib/blog-text", () => ({
    ARTICLE_FIELDS: [],
    ARTICLE_TEXT: {},
    articlesIn: async (rows: unknown[]) => rows,
    localeOf: () => "",
}));

const { GET, PATCH } = await import("@/modules/blog/api/articles/[id]/route");
const { NextRequest } = await import("next/server");

const PAST = new Date("2020-01-01");
function article(over: Partial<Row> = {}): Row {
    return {
        id: "a1", number: 1, slug: "hello", title: "Hello", authorId: "writer",
        status: "PUBLISHED", publishedAt: PAST, publishAt: null, ...over,
    };
}

function read(id = "1") {
    return GET(new NextRequest(`http://x/api/v1/blog/articles/${id}`), { params: Promise.resolve({ id }) });
}

function edit(body: unknown) {
    return PATCH(new NextRequest("http://x/api/v1/blog/articles/a1", {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
    }), { params: Promise.resolve({ id: "a1" }) });
}

beforeEach(() => {
    state.row = null;
    state.user = null;
    state.may = new Set();
    recordRevision.mockClear();
    update.mockClear();
});

describe("reading an article by its number", () => {
    it("answers with a published one", async () => {
        state.row = article();
        expect((await read()).status).toBe(200);
    });

    it("does not answer a stranger with a draft, an archived article or one not yet released", async () => {
        for (const over of [
            { status: "DRAFT", publishedAt: null },
            { status: "ARCHIVED" },
            { status: "DRAFT" },
            { status: "PUBLISHED", publishedAt: new Date(Date.now() + 86_400_000) },
            { status: "PUBLISHED", publishAt: new Date(Date.now() + 86_400_000) },
        ]) {
            state.row = article(over);
            expect((await read()).status, JSON.stringify(over)).toBe(404);
        }
    });

    it("still shows a draft to its author and to whoever may publish or edit any article", async () => {
        state.row = article({ status: "DRAFT", publishedAt: null });
        state.user = { id: "writer" };
        expect((await read()).status).toBe(200);
        for (const permission of ["blog.publish", "blog.edit-any"]) {
            state.user = { id: "editor" };
            state.may = new Set([permission]);
            expect((await read()).status, permission).toBe(200);
        }
        state.may = new Set();
        expect((await read()).status).toBe(404);
    });
});

describe("an edit that is refused", () => {
    beforeEach(() => {
        state.row = article({ status: "DRAFT", publishedAt: null });
        state.user = { id: "writer" };
    });

    it("records no revision when the body does not validate", async () => {
        const res = await edit({ title: 42 });
        expect(res.status).toBe(400);
        expect(recordRevision).not.toHaveBeenCalled();
    });

    it("records no revision when the writer may not publish", async () => {
        const res = await edit({ status: "PUBLISHED" });
        expect(res.status).toBe(403);
        expect(recordRevision).not.toHaveBeenCalled();
    });

    it("records one for an edit that goes through", async () => {
        const res = await edit({ excerpt: "Better words." });
        expect(res.status).toBe(200);
        expect(recordRevision).toHaveBeenCalledTimes(1);
    });
});
