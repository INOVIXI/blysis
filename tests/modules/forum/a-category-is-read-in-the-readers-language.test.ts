// @vitest-environment node
/**
 * A forum category's name and description, written once per language, are
 * read in the reader's. What members write - topics and replies - is theirs
 * and is never translated.
 *
 * The columns keep what the admin typed, the original; a translation is a
 * `ContentTranslation` row saved in the same transaction. The board, a topic
 * and the endpoints ask with the reader's language, and a language with no
 * translation reads the original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const body: { value: unknown } = { value: {} };

const forumCategory = fakeTable(() => ({ description: null, icon: null, color: null, parentId: null, order: 0, isActive: true }));
const forumCategoryPermission = fakeTable();
const forumTopic = fakeTable(() => ({ moderationState: "APPROVED", isPinned: false, createdAt: new Date(), authorId: null }));
const forumPost = fakeTable();
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);

/**
 * The in-memory tables know no relations, so a topic is read with its
 * category the way Prisma would join it.
 */
function withCategory(row: Record<string, unknown>) {
    const category = forumCategory.table.rows.find((c) => c.id === row.categoryId)!;
    return {
        ...row,
        author: null,
        category: { id: category.id, name: category.name, slug: category.slug, color: category.color },
        posts: [],
        _count: { posts: 0, likes: 0 },
    };
}
const topicRows = forumTopic.findMany.getMockImplementation()!;
forumTopic.findMany.mockImplementation(async (args = {}) => (await topicRows(args)).map(withCategory));
const topicRow = forumTopic.findFirst.getMockImplementation()!;
forumTopic.findFirst.mockImplementation(async (args) => {
    const row = await topicRow(args);
    return row ? withCategory(row) : null;
});
// `_count` on a category is the number of its topics.
const categoryRows = forumCategory.findMany.getMockImplementation()!;
forumCategory.findMany.mockImplementation(async (args = {}) =>
    (await categoryRows(args)).map((row) => ({ ...row, _count: { topics: forumTopic.table.rows.filter((t) => t.categoryId === row.id).length } })));

const categoryRow = forumCategory.findUnique.getMockImplementation()!;
forumCategory.findUnique.mockImplementation(async (args) => {
    const row = await categoryRow(args);
    return row ? { ...row, _count: { topics: forumTopic.table.rows.filter((t) => t.categoryId === row.id).length } } : null;
});

const db: Record<string, unknown> = { forumCategory, forumCategoryPermission, forumTopic, forumPost, contentTranslation };
db.$transaction = fakeTransaction(db, [forumCategory.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        isAdmin: async () => true,
        readJsonBody: async () => body.value,
        moduleSettings: async () => ({ allowGuestView: true, topicsPerPage: 20, postsPerPage: 20 }),
        pageParams: (await vi.importActual<typeof import("@/core/lib/page-params")>("@/core/lib/page-params")).pageParams,
        textContains: () => [],
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin", role: null } }) }));
vi.mock("@/core/sdk", async () => ({
    ...(await vi.importActual<typeof import("@/core/sdk")>("@/core/sdk")),
    generateSlug: (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
}));

const categories = () => import("@/modules/forum/api/categories/route");
const category = () => import("@/modules/forum/api/categories/[id]/route");
const topics = () => import("@/modules/forum/api/topics/route");
const reads = () => import("@/modules/forum/lib/read-topic");

async function create(payload: Record<string, unknown>) {
    body.value = payload;
    const { POST } = await categories();
    const res = await POST(new Request("https://example.com", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

async function listed(lang: string) {
    const { GET } = await categories();
    const { NextRequest } = await import("next/server");
    return (await (await GET(new NextRequest(`https://example.com/api/v1/forum/categories?locale=${lang}`))).json()).categories as { name: string; description: string | null }[];
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function seed() {
    const { status, json } = await create({
        name: "Duyurular", slug: "duyurular", description: "Sunucudan haberler",
        translations: { name: { en: "Announcements" }, description: { en: "News from the server", de: "Neuigkeiten vom Server" } },
    });
    expect(status).toBe(201);
    forumTopic.table.rows.push({ id: "t1", slug: "t1", title: "Yeni sezon", content: "Üye yazdı", categoryId: json.category.id, moderationState: "APPROVED", isPinned: false, createdAt: new Date() });
    return json.category.id as string;
}

beforeEach(() => {
    forumCategory.table.rows = [];
    forumTopic.table.rows = [];
    contentTranslation.table.rows = [];
});

describe("a forum category written in three languages", () => {
    it("is listed for each reader in their own, and in the original where theirs is missing", async () => {
        await seed();
        expect(await listed("tr")).toMatchObject([{ name: "Duyurular", description: "Sunucudan haberler" }]);
        expect(await listed("en")).toMatchObject([{ name: "Announcements", description: "News from the server" }]);
        expect(await listed("de")).toMatchObject([{ name: "Duyurular", description: "Neuigkeiten vom Server" }]);
        expect(forumCategory.table.rows[0]).toMatchObject({ name: "Duyurular" });
    });

    it("names the section a topic is in, on the board, on the topic and on the endpoint, and leaves what members wrote alone", async () => {
        await seed();
        const { readTopicList, readTopic } = await reads();

        const board = await readTopicList({ page: 1, locale: "en" });
        expect(board?.categories).toMatchObject([{ name: "Announcements" }]);
        expect(board?.topics).toMatchObject([{ title: "Yeni sezon", category: { name: "Announcements" } }]);
        expect((await readTopicList({ page: 1, locale: "fr" }))?.topics).toMatchObject([{ category: { name: "Duyurular" } }]);

        expect((await readTopic("t1", 1, "en"))?.topic).toMatchObject({ title: "Yeni sezon", content: "Üye yazdı", category: { name: "Announcements" } });
        expect((await readTopic("t1", 1, "de"))?.topic).toMatchObject({ category: { name: "Duyurular" } });

        const { GET } = await topics();
        const { NextRequest } = await import("next/server");
        const latest = await (await GET(new NextRequest("https://example.com/api/v1/forum/topics?order=newest&locale=en"))).json();
        expect(latest.topics).toMatchObject([{ title: "Yeni sezon", category: { name: "Announcements" } }]);
    });

    it("is handed to the editor with every language, edited language by language, and takes them when deleted", async () => {
        const id = await seed();
        const { GET } = await categories();
        const { NextRequest } = await import("next/server");
        const admin = await (await GET(new NextRequest("https://example.com/api/v1/forum/categories?scope=admin"))).json();
        expect(admin.categories).toEqual([expect.objectContaining({ translations: expect.objectContaining({ name: { en: "Announcements" } }) })]);

        body.value = { name: "Haberler", translations: { name: { de: "Nachrichten" } } };
        const { PATCH, DELETE } = await category();
        expect((await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(id))).status).toBe(200);
        expect(await listed("en")).toMatchObject([{ name: "Haberler", description: "News from the server" }]);
        expect(await listed("de")).toMatchObject([{ name: "Nachrichten" }]);

        forumTopic.table.rows = [];
        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(id));
        expect(contentTranslation.table.rows).toHaveLength(0);
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status } = await create({ name: "Duyurular", translations: { name: { en: "x".repeat(101) } } });
        expect(status).toBe(400);
        expect(forumCategory.table.rows).toHaveLength(0);
    });
});
