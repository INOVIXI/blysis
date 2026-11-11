// @vitest-environment node
/**
 * A help centre the admin wrote once per language is read in the reader's.
 *
 * A section's name and description and an article's title and Markdown body
 * stay in their columns as the admin typed them, the original; a translation
 * is a `ContentTranslation` row saved in the same transaction. The pages ask
 * with their own language, the endpoints with `?locale=`, and a reader whose
 * language has no translation reads the original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const body: { value: unknown } = { value: {} };
const admin = { value: true };

const helpCategory = fakeTable(() => ({ description: null, icon: null, image: null, order: 0, isActive: true, createdAt: new Date() }));
const helpArticle = fakeTable(() => ({ views: 0, helpful: 0, notHelpful: 0, isActive: true, createdAt: new Date() }));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);

// The in-memory table has no relations: an article is handed its section and
// a section its count, the way Prisma's `include` and `select` would.
type Row = Record<string, unknown>;
function categoryOf(row: Row) {
    const category = helpCategory.table.rows.find((c) => c.id === row.categoryId);
    return category ? { id: category.id, name: category.name, slug: category.slug } : null;
}
const articles = {
    ...helpArticle,
    findUnique: async (args: { where: Row; select?: Record<string, unknown> }) => {
        const row = await helpArticle.findUnique({ where: args.where });
        return row ? { ...row, category: categoryOf(row) } : null;
    },
    findMany: async (args: { where?: Row; orderBy?: unknown; take?: number; select?: Record<string, unknown> } = {}) => {
        const rows = await helpArticle.findMany({ where: args.where, orderBy: args.orderBy, take: args.take });
        return rows.map((row) => ({ ...row, category: categoryOf(row) }));
    },
    create: async (args: { data: Row }) => {
        const row = await helpArticle.create({ data: args.data });
        return { ...row, category: categoryOf(row) };
    },
};
const count = (row: Row) => ({ articles: helpArticle.table.rows.filter((a) => a.categoryId === row.id).length });
const categories = {
    ...helpCategory,
    findUnique: async (args: { where: Row }) => {
        const row = await helpCategory.findUnique({ where: args.where });
        return row ? { ...row, _count: count(row) } : null;
    },
    findMany: async (args: { where?: Row; orderBy?: unknown; take?: number } = {}) => {
        const rows = await helpCategory.findMany({ where: args.where, orderBy: args.orderBy, take: args.take });
        return rows.map((row) => ({ ...row, _count: count(row) }));
    },
};

const fullText: { rows: Row[] } = { rows: [] };

const db: Record<string, unknown> = {
    helpCategory: categories,
    helpArticle: articles,
    contentTranslation,
    $queryRaw: async () => fullText.rows,
    activityFeedItem: { create: async () => ({}) },
};
db.$transaction = fakeTransaction(db, [helpCategory.table, helpArticle.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    const { pageParams } = await vi.importActual<typeof import("@/core/lib/page-params")>("@/core/lib/page-params");
    return {
        ...translations,
        pageParams,
        prisma: db,
        isAdmin: async () => admin.value,
        logActivity: async () => {},
        readJsonBody: async () => body.value,
        rateLimitForRole: async () => ({ success: true }),
        moduleSettings: async () => ({ showViewCount: true, enableFeedback: true, enableSearch: true }),
        textContains: (columns: string[], term: string) => columns.map((c) => ({ [c]: { contains: term } })),
        getClientIP: () => "127.0.0.1",
        searchMatches: () => "",
        searchRank: () => "",
        log: { warn: () => {} },
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin", role: "admin" } }) }));
vi.mock("@/core/sdk", () => ({
    slugify: (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    doActionAsync: async () => {},
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const categoryList = () => import("../../../module-sources/help-center/api/help/categories/route");
const categoryOne = () => import("../../../module-sources/help-center/api/help/categories/[id]/route");
const articleList = () => import("../../../module-sources/help-center/api/help/articles/route");
const articleOne = () => import("../../../module-sources/help-center/api/help/articles/[slug]/route");
const reads = () => import("../../../module-sources/help-center/lib/read-article");
const siteSearch = () => import("../../../module-sources/help-center/search/handler");

async function post(route: () => Promise<{ POST: (r: never) => Promise<Response> }>, payload: Record<string, unknown>) {
    body.value = payload;
    const { POST } = await route();
    const res = await POST(new Request("https://example.com", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

async function readArticleApi(slug: string, query = "") {
    const { GET } = await articleOne();
    const res = await GET(new Request(`https://example.com/api/v1/help/articles/${slug}${query}`) as never, { params: Promise.resolve({ slug }) });
    return (await res.json()) as Record<string, unknown>;
}

async function seed() {
    const category = await post(categoryList, {
        name: "Hesap", description: "Hesabın hakkında",
        translations: { name: { en: "Account", de: "Konto" }, description: { en: "About your account" } },
    });
    const article = await post(articleList, {
        title: "Şifremi unuttum", slug: "sifre", content: "## Adım bir\n\nE-postana bak.", categoryId: category.json.id,
        translations: { title: { en: "I forgot my password" }, content: { en: "## Step one\n\nCheck your email.", de: "## Schritt eins" } },
    });
    return { categoryId: category.json.id as string, articleId: article.json.id as string, status: [category.status, article.status] };
}

beforeEach(() => {
    helpCategory.table.rows = [];
    helpArticle.table.rows = [];
    contentTranslation.table.rows = [];
    fullText.rows = [];
    admin.value = true;
});

describe("a help centre written in three languages", () => {
    it("serves an article in each reader's language, and the original where theirs is missing", async () => {
        const { status } = await seed();
        expect(status).toEqual([201, 201]);

        expect(await readArticleApi("sifre", "?locale=tr")).toMatchObject({
            title: "Şifremi unuttum", content: "## Adım bir\n\nE-postana bak.", category: { name: "Hesap" },
        });
        expect(await readArticleApi("sifre", "?locale=en")).toMatchObject({
            title: "I forgot my password", content: "## Step one\n\nCheck your email.", category: { name: "Account" },
        });
        expect(await readArticleApi("sifre", "?locale=de")).toMatchObject({
            title: "Şifremi unuttum", content: "## Schritt eins", category: { name: "Konto" },
        });
        expect(await readArticleApi("sifre")).toMatchObject({ title: "Şifremi unuttum" });
        // The columns keep the original, where search and the sitemap read it.
        expect(helpArticle.table.rows[0]).toMatchObject({ title: "Şifremi unuttum" });
    });

    it("draws the pages in the reader's language: the article, its neighbours, the index and the section", async () => {
        await seed();
        const { readArticle, readHelpIndex, readHelpCategory, searchHelpArticles } = await reads();

        const en = await readArticle("sifre", "en");
        expect(en?.article).toMatchObject({ title: "I forgot my password", category: { name: "Account" } });
        expect(en?.neighbours).toMatchObject([{ title: "I forgot my password" }]);

        expect(await readHelpIndex("en")).toMatchObject({
            categories: [{ name: "Account", description: "About your account" }],
            popular: [{ title: "I forgot my password" }],
        });
        expect(await readHelpIndex("de")).toMatchObject({
            categories: [{ name: "Konto", description: "Hesabın hakkında" }],
            popular: [{ title: "Şifremi unuttum" }],
        });
        expect(await readHelpCategory("hesap", "en")).toMatchObject({
            category: { name: "Account" },
            articles: [{ title: "I forgot my password" }],
        });
        // A search matches the original, and draws what it found in the
        // reader's language.
        expect(await searchHelpArticles("Şifre", "en")).toMatchObject([{ title: "I forgot my password", category: { name: "Account" } }]);
    });

    it("lists the sections and the articles in the reader's language", async () => {
        await seed();
        const { GET: listCategories } = await categoryList();
        const sections = await (await listCategories(new Request("https://example.com/api/v1/help/categories?locale=en") as never)).json();
        expect(sections).toMatchObject([{ name: "Account", description: "About your account" }]);

        const { GET: listArticles } = await articleList();
        const found = await (await listArticles(new Request("https://example.com/api/v1/help/articles?locale=en") as never)).json();
        expect(found).toMatchObject([{ title: "I forgot my password", category: { name: "Account" } }]);
    });

    it("hands the admin's editor every language of each section and article", async () => {
        const { categoryId, articleId } = await seed();
        const { GET: listCategories } = await categoryList();
        const sections = await (await listCategories(new Request("https://example.com/api/v1/help/categories?scope=admin") as never)).json();
        expect(sections.categories).toEqual([expect.objectContaining({
            id: categoryId,
            name: "Hesap",
            translations: { name: { en: "Account", de: "Konto" }, description: { en: "About your account" } },
        })]);

        const { GET: listArticles } = await articleList();
        const found = await (await listArticles(new Request("https://example.com/api/v1/help/articles?scope=admin") as never)).json();
        expect(found.articles).toEqual([expect.objectContaining({
            id: articleId,
            title: "Şifremi unuttum",
            translations: { title: { en: "I forgot my password" }, content: { en: "## Step one\n\nCheck your email.", de: "## Schritt eins" } },
        })]);
    });

    it("is edited language by language: a field it sends is replaced, one it does not is kept", async () => {
        const { categoryId } = await seed();
        body.value = { title: "Parola sıfırlama", translations: { title: { de: "Passwort zurücksetzen" } } };
        const { PATCH } = await articleOne();
        const res = await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, { params: Promise.resolve({ slug: "sifre" }) });
        expect(res.status).toBe(200);
        expect(await readArticleApi("sifre", "?locale=en")).toMatchObject({ title: "Parola sıfırlama", content: "## Step one\n\nCheck your email." });
        expect(await readArticleApi("sifre", "?locale=de")).toMatchObject({ title: "Passwort zurücksetzen" });

        body.value = { description: "Yeni", translations: { description: {} } };
        const { PATCH: patchCategory } = await categoryOne();
        await patchCategory(new Request("https://example.com", { method: "PATCH" }) as never, { params: Promise.resolve({ id: categoryId }) });
        const { readHelpIndex } = await reads();
        expect(await readHelpIndex("en")).toMatchObject({ categories: [{ name: "Account", description: "Yeni" }] });
    });

    it("takes the translations with what is deleted", async () => {
        const { categoryId } = await seed();
        const { DELETE } = await articleOne();
        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, { params: Promise.resolve({ slug: "sifre" }) });
        expect(contentTranslation.table.rows.every((r) => r.entity === "category")).toBe(true);

        const { DELETE: deleteCategory } = await categoryOne();
        await deleteCategory(new Request("https://example.com", { method: "DELETE" }) as never, { params: Promise.resolve({ id: categoryId }) });
        expect(contentTranslation.table.rows).toHaveLength(0);
    });

    it("is found by the site's search under a title it has only in a translation", async () => {
        await seed();
        await post(articleList, { title: "Kurallar", slug: "kurallar", content: "Küfür yasak, lütfen.", categoryId: helpCategory.table.rows[0].id });
        const search = (await siteSearch()).default;

        // The columns hold Turkish, so the full-text index finds nothing for
        // an English phrase; the translation does.
        expect(await search("forgot my PASSWORD")).toEqual([
            expect.objectContaining({ title: "Şifremi unuttum", href: "/help/sifre" }),
        ]);

        // What the columns found comes first, and is not listed twice.
        fullText.rows = [{ title: "Şifremi unuttum", slug: "sifre", content: "## Adım bir" }];
        expect((await search("password")).map((r) => r.href)).toEqual(["/help/sifre"]);

        // A taken-down article stays out, whatever language it is found in.
        helpArticle.table.rows[0].isActive = false;
        fullText.rows = [];
        expect(await search("forgot my password")).toEqual([]);
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status } = await post(categoryList, { name: "Hesap", translations: { name: { en: "x".repeat(101) } } });
        expect(status).toBe(400);
        expect(helpCategory.table.rows).toHaveLength(0);
        expect(contentTranslation.table.rows).toHaveLength(0);
    });
});
