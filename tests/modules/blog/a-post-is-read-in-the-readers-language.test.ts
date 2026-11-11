// @vitest-environment node
/**
 * An article and a category the admin wrote once per language are read in
 * the reader's.
 *
 * The title, the excerpt and the body, and a category's name and
 * description, stay in their columns as the admin typed them, the original;
 * a translation is a `ContentTranslation` row saved in the same transaction.
 * The blog's pages and blocks ask with the page's language, and a reader
 * whose language has no translation reads the original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const session: { value: { user: { id: string } } | null } = { value: { user: { id: "admin" } } };
const allowed = { value: true };
const body: { value: unknown } = { value: {} };

const blogArticle = fakeTable(() => ({
    status: "DRAFT", publishedAt: null, publishAt: null, excerpt: null, coverImage: null,
    categoryId: null, authorId: "admin", views: 0, createdAt: new Date(),
}));
// Prisma leaves a column it is handed `undefined` for as it was; the fake
// would write the `undefined`, and a PATCH names every column it might touch.
const writeAll = blogArticle.update;
blogArticle.update = vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
    writeAll({ ...args, data: Object.fromEntries(Object.entries(args.data).filter(([, value]) => value !== undefined)) }),
);
const blogCategory = fakeTable(() => ({ description: null }));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = { blogArticle, blogCategory, contentTranslation };
// The full-text path needs Postgres; without it the search falls back to its
// column match, which the fake can read.
db.$queryRaw = async () => { throw new Error("no full-text index here"); };
db.$transaction = fakeTransaction(db, [blogArticle.table, blogCategory.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    const pages = await vi.importActual<typeof import("@/core/lib/page-params")>("@/core/lib/page-params");
    const query = await vi.importActual<typeof import("@/core/lib/api-query")>("@/core/lib/api-query");
    return {
        ...translations,
        pageParams: pages.pageParams,
        enumParam: query.enumParam,
        prisma: db,
        hasPermission: async () => allowed.value,
        readJsonBody: async () => body.value,
        recordRevision: async () => {},
        log: { warn: () => {} },
        searchMatches: () => "",
        searchRank: () => "",
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => session.value }));
vi.mock("@/core/sdk", () => ({
    generateSlug: (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    doActionAsync: async () => {},
}));

const articles = () => import("../../../module-sources/blog/api/articles/route");
const article = () => import("../../../module-sources/blog/api/articles/[id]/route");
const categories = () => import("../../../module-sources/blog/api/categories/route");
const category = () => import("../../../module-sources/blog/api/categories/[id]/route");
const search = () => import("../../../module-sources/blog/search/handler");
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function listArticles(locale?: string) {
    const { GET } = await articles();
    const res = await GET(new Request(`https://example.com/api/v1/blog/articles${locale ? `?locale=${locale}` : ""}`) as never);
    return (await res.json()).articles as Record<string, unknown>[];
}

async function readArticle(id: string, query = "") {
    const { GET } = await article();
    const res = await GET(new Request(`https://example.com/api/v1/blog/articles/${id}${query}`) as never, params(id));
    return { status: res.status, json: await res.json() };
}

async function createArticle(payload: Record<string, unknown>) {
    body.value = { status: "PUBLISHED", ...payload };
    const { POST } = await articles();
    const res = await POST(new Request("https://example.com/api/v1/blog/articles", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

async function createCategory(payload: Record<string, unknown>) {
    body.value = payload;
    const { POST } = await categories();
    const res = await POST(new Request("https://example.com/api/v1/blog/categories", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

async function listCategories(query = "") {
    const { GET } = await categories();
    const res = await GET(new Request(`https://example.com/api/v1/blog/categories${query}`) as never);
    return { status: res.status, json: await res.json() };
}

beforeEach(() => {
    blogArticle.table.rows = [];
    blogCategory.table.rows = [];
    contentTranslation.table.rows = [];
    session.value = { user: { id: "admin" } };
    allowed.value = true;
});

describe("an article written in three languages", () => {
    const post = {
        title: "Sezon başladı",
        excerpt: "Yeni harita açıldı",
        content: "## Yenilikler\n\nYeni harita.",
        translations: {
            title: { en: "The season has begun", de: "Die Saison beginnt" },
            excerpt: { en: "A new map is open" },
            content: { en: "## What's new\n\nA new map." },
        },
    };

    it("is read by each reader in their own, and in the original where theirs is missing", async () => {
        const { status, json } = await createArticle(post);
        expect(status).toBe(201);

        allowed.value = false;
        expect(await listArticles("tr")).toMatchObject([{ title: "Sezon başladı", excerpt: "Yeni harita açıldı" }]);
        expect(await listArticles("en")).toMatchObject([{ title: "The season has begun", excerpt: "A new map is open" }]);
        expect(await listArticles("de")).toMatchObject([{ title: "Die Saison beginnt", excerpt: "Yeni harita açıldı" }]);
        expect(await listArticles()).toMatchObject([{ title: "Sezon başladı" }]);

        expect((await readArticle(json.id, "?locale=en")).json).toMatchObject({ title: "The season has begun", content: "## What's new\n\nA new map." });
        expect((await readArticle(json.id, "?locale=fr")).json).toMatchObject({ title: "Sezon başladı", content: "## Yenilikler\n\nYeni harita." });
    });

    it("keeps the original in the column, where search and the slug read it", async () => {
        await createArticle(post);
        expect(blogArticle.table.rows[0]).toMatchObject({ title: "Sezon başladı", slug: "sezon-ba-lad-" });
    });

    it("is handed to the editor with every language, and only to whoever may edit it", async () => {
        const { json } = await createArticle(post);
        const editor = await readArticle(json.id, "?scope=admin");
        expect(editor.json).toMatchObject({ title: "Sezon başladı", translations: post.translations });

        allowed.value = false;
        session.value = { user: { id: "someone-else" } };
        expect((await readArticle(json.id, "?scope=admin")).status).toBe(403);
    });

    it("is edited language by language: a field it sends is replaced, one it does not is kept", async () => {
        const { json } = await createArticle(post);
        body.value = { title: "Sezon sürüyor", translations: { title: { de: "Die Saison läuft" } } };
        const { PATCH } = await article();
        const res = await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(json.id));
        expect(res.status).toBe(200);

        expect(await listArticles("en")).toMatchObject([{ title: "Sezon sürüyor", excerpt: "A new map is open" }]);
        expect(await listArticles("de")).toMatchObject([{ title: "Die Saison läuft" }]);
    });

    it("takes its translations with it when it is deleted", async () => {
        const { json } = await createArticle(post);
        await createArticle({ title: "Başka yazı", content: "Başka bir metin burada.", translations: { title: { en: "Another post" } } });
        const { DELETE } = await article();
        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(json.id));
        expect(contentTranslation.table.rows.map((r) => r.text)).toEqual(["Another post"]);
    });

    it("is found by a word it says only in a translation, named by its original", async () => {
        await createArticle(post);
        await createArticle({ title: "Taslak", content: "Yayınlanmamış bir yazı.", status: "DRAFT", translations: { title: { en: "The season draft" } } });
        const { default: find } = await search();
        expect(await find("season")).toEqual([expect.objectContaining({ title: "Sezon başladı", href: "/blog/sezon-ba-lad-" })]);
        // Found once, though it matches in its column and in a translation.
        expect(await find("sezon")).toHaveLength(1);
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status } = await createArticle({ ...post, translations: { title: { en: "x".repeat(201) } } });
        expect(status).toBe(400);
        expect(blogArticle.table.rows).toHaveLength(0);
        expect(contentTranslation.table.rows).toHaveLength(0);
    });
});

describe("a category written in three languages", () => {
    it("is listed under its name in the reader's language, and named so on its articles", async () => {
        const { status, json } = await createCategory({
            name: "Duyurular", description: "Sunucu haberleri",
            translations: { name: { en: "Announcements", de: "Ankündigungen" }, description: { en: "Server news" } },
        });
        expect(status).toBe(201);

        expect((await listCategories("?locale=en")).json).toMatchObject([{ name: "Announcements", description: "Server news" }]);
        expect((await listCategories("?locale=de")).json).toMatchObject([{ name: "Ankündigungen", description: "Sunucu haberleri" }]);
        expect((await listCategories("?locale=tr")).json).toMatchObject([{ name: "Duyurular" }]);

        // The fake keeps no relations, so the joined category is laid on the row.
        await createArticle({ title: "Bakım", content: "Bakım bu akşam yapılacak.", categoryId: json.id });
        blogArticle.table.rows[0].category = { id: json.id, name: "Duyurular", slug: "duyurular" };
        allowed.value = false;
        expect(await listArticles("en")).toMatchObject([{ category: { name: "Announcements" } }]);
        expect(await listArticles("fr")).toMatchObject([{ category: { name: "Duyurular" } }]);
    });

    it("is handed to the editor with every language, and only to whoever manages the blog", async () => {
        await createCategory({ name: "Duyurular", translations: { name: { en: "Announcements" } } });
        expect((await listCategories("?scope=admin")).json).toMatchObject([{ name: "Duyurular", translations: { name: { en: "Announcements" } } }]);
        allowed.value = false;
        expect((await listCategories("?scope=admin")).status).toBe(403);
    });

    it("is edited and deleted with its translations", async () => {
        const { json } = await createCategory({ name: "Duyurular", translations: { name: { en: "Announcements" } } });
        body.value = { description: "Haberler", translations: { description: { en: "News" } } };
        const { PATCH, DELETE } = await category();
        expect((await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(json.id))).status).toBe(200);
        expect((await listCategories("?locale=en")).json).toMatchObject([{ name: "Announcements", description: "News" }]);

        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(json.id));
        expect(contentTranslation.table.rows).toHaveLength(0);
    });
});
