// @vitest-environment node
/**
 * A page the admin wrote once per language is read in the reader's.
 *
 * The title and the Markdown body stay in their columns as the admin typed
 * them, the original, and a body written per language is a
 * `ContentTranslation` row beside it. The page asks with its own language;
 * a reader whose language has no translation reads the original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const body: { value: unknown } = { value: {} };
const admin = { value: true };

const customPage = fakeTable(() => ({ isActive: true, order: 0, createdAt: new Date() }));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = { customPage, contentTranslation };
db.$transaction = fakeTransaction(db, [customPage.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        isAdmin: async () => admin.value,
        readJsonBody: async () => body.value,
        recordRevision: async () => {},
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin" } }) }));
vi.mock("@/core/sdk", () => ({ generateSlug: (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-") }));

const list = () => import("../../../module-sources/custom-pages/api/route");
const one = () => import("../../../module-sources/custom-pages/api/[slug]/route");
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function readPage(slug: string, query = "") {
    const { GET } = await one();
    const res = await GET(new Request(`https://example.com/api/v1/custom-pages/${slug}${query}`) as never, params(slug));
    return { status: res.status, page: (await res.json()).page as Record<string, unknown> };
}

async function readList(query = "") {
    const { GET } = await list();
    const res = await GET(new Request(`https://example.com/api/v1/custom-pages${query}`) as never);
    return (await res.json()).pages as Record<string, unknown>[];
}

async function create(payload: Record<string, unknown>) {
    body.value = payload;
    const { POST } = await list();
    const res = await POST(new Request("https://example.com/api/v1/custom-pages", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

beforeEach(() => {
    customPage.table.rows = [];
    contentTranslation.table.rows = [];
    admin.value = true;
});

describe("a page written in three languages", () => {
    it("is read by each reader in their own, and in the original where theirs is missing", async () => {
        const { status } = await create({
            title: "Kurallar", slug: "rules", content: "## Kural bir\n\nKüfür yok.",
            translations: {
                title: { en: "Rules", de: "Regeln" },
                content: { en: "## Rule one\n\nNo swearing." },
            },
        });
        expect(status).toBe(201);

        expect((await readPage("rules", "?locale=tr")).page).toMatchObject({ title: "Kurallar", content: "## Kural bir\n\nKüfür yok." });
        expect((await readPage("rules", "?locale=en")).page).toMatchObject({ title: "Rules", content: "## Rule one\n\nNo swearing." });
        expect((await readPage("rules", "?locale=de")).page).toMatchObject({ title: "Regeln", content: "## Kural bir\n\nKüfür yok." });
        expect((await readPage("rules")).page).toMatchObject({ title: "Kurallar" });
    });

    it("is listed under its title in the reader's language", async () => {
        await create({ title: "Kurallar", slug: "rules", content: "x", translations: { title: { en: "Rules" } } });
        expect(await readList("?locale=en")).toMatchObject([{ title: "Rules", slug: "rules" }]);
        expect(await readList("?locale=fr")).toMatchObject([{ title: "Kurallar" }]);
    });

    it("keeps the original in its columns and its address", async () => {
        await create({ title: "Kurallar", slug: "rules", content: "Metin", translations: { title: { en: "Rules" } } });
        expect(customPage.table.rows[0]).toMatchObject({ title: "Kurallar", slug: "rules", content: "Metin" });
    });

    it("is opened in the editor with every language, a draft too", async () => {
        await create({ title: "Taslak", slug: "draft", content: "Metin", isActive: false, translations: { content: { en: "Text" } } });
        expect((await readPage("draft")).status).toBe(404);
        const { status, page } = await readPage("draft", "?scope=admin");
        expect(status).toBe(200);
        expect(page).toMatchObject({ title: "Taslak", content: "Metin", translations: { content: { en: "Text" } } });
    });

    it("refuses the editor's answer to anybody who is not an admin", async () => {
        await create({ title: "Taslak", slug: "draft", content: "Metin", isActive: false });
        admin.value = false;
        expect((await readPage("draft", "?scope=admin")).status).toBe(403);
    });

    it("is edited language by language and keeps the fields it was not sent", async () => {
        await create({ title: "Kurallar", slug: "rules", content: "Metin", translations: { title: { en: "Rules" }, content: { en: "Text" } } });
        body.value = { content: "Yeni metin", translations: { content: { en: "New text" } } };
        const { PATCH } = await one();
        const res = await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params("rules"));
        expect(res.status).toBe(200);
        expect((await readPage("rules", "?locale=en")).page).toMatchObject({ title: "Rules", content: "New text" });
    });

    // Core puts what the resolver answers in the browser tab, so a reader
    // whose page body was in their language still read the original title
    // above it in the tab.
    it("names itself in the tab in the reader's language", async () => {
        await create({ title: "Kurallar", slug: "rules", content: "Metin", translations: { title: { en: "Rules" } } });
        const { default: resolve } = await import("../../../module-sources/custom-pages/lib/route-exists");
        expect(await resolve({ slug: "rules" }, { locale: "en" })).toEqual({ title: "Rules" });
        expect(await resolve({ slug: "rules" }, { locale: "de" })).toEqual({ title: "Kurallar" });
        expect(await resolve({ slug: "missing" }, { locale: "en" })).toBe(false);
    });

    it("takes its translations with it when it is deleted", async () => {
        await create({ title: "Kurallar", slug: "rules", content: "Metin", translations: { title: { en: "Rules" } } });
        const { DELETE } = await one();
        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params("rules"));
        expect(contentTranslation.table.rows).toHaveLength(0);
    });
});
