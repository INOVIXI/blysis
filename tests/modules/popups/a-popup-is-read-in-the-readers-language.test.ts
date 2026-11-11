// @vitest-environment node
/**
 * A popup the admin wrote once per language is read in the reader's.
 *
 * The title, the body and the button's words stay in their columns as the
 * admin typed them, the original; translations are `ContentTranslation` rows
 * saved in the same transaction. The renderer asks with the page's language,
 * and a reader whose language has no translation reads the original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const body: { value: unknown } = { value: {} };

const popup = fakeTable(() => ({ isActive: true, startsAt: null, endsAt: null, createdAt: new Date() }));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = { popup, contentTranslation };
db.$transaction = fakeTransaction(db, [popup.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return { ...translations, prisma: db, isAdmin: async () => true, readJsonBody: async () => body.value };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin" } }) }));

const list = () => import("../../../module-sources/popups/api/route");
const one = () => import("../../../module-sources/popups/api/[id]/route");
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function read(query: string) {
    const { GET } = await list();
    const res = await GET(new Request(`https://example.com/api/v1/popups${query}`) as never);
    return (await res.json()).popups as Record<string, unknown>[];
}

async function create(payload: Record<string, unknown>) {
    body.value = payload;
    const { POST } = await list();
    const res = await POST(new Request("https://example.com/api/v1/popups", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

beforeEach(() => {
    popup.table.rows = [];
    contentTranslation.table.rows = [];
});

describe("a popup written in three languages", () => {
    it("is read by each reader in their own, and in the original where theirs is missing", async () => {
        const { status } = await create({
            title: "Yeni sezon", content: "**Cuma** başlıyor", link: "https://example.com/s4", linkText: "Göz at",
            translations: {
                title: { en: "New season" },
                content: { en: "Starts **Friday**", de: "Beginnt **Freitag**" },
                linkText: { en: "Take a look" },
            },
        });
        expect(status).toBe(201);

        expect(await read("?locale=tr")).toMatchObject([{ title: "Yeni sezon", content: "**Cuma** başlıyor", linkText: "Göz at" }]);
        expect(await read("?locale=en")).toMatchObject([{ title: "New season", content: "Starts **Friday**", linkText: "Take a look" }]);
        expect(await read("?locale=de")).toMatchObject([{ title: "Yeni sezon", content: "Beginnt **Freitag**", linkText: "Göz at" }]);
        expect(await read("")).toMatchObject([{ title: "Yeni sezon" }]);
    });

    it("is handed to the admin's screen with every language", async () => {
        await create({ title: "Yeni sezon", translations: { title: { en: "New season" } } });
        expect(await read("?scope=admin")).toMatchObject([{ title: "Yeni sezon", translations: { title: { en: "New season" } } }]);
    });

    it("is edited language by language and keeps the fields it was not sent", async () => {
        const { json } = await create({ title: "Yeni sezon", content: "Metin", translations: { title: { en: "New season" }, content: { en: "Text" } } });
        body.value = { title: "Sezon 4", translations: { title: { en: "Season 4" } } };
        const { PATCH } = await one();
        const res = await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(json.popup.id));
        expect(res.status).toBe(200);
        expect(await read("?locale=en")).toMatchObject([{ title: "Season 4", content: "Text" }]);
    });

    it("takes its translations with it when it is deleted", async () => {
        const { json } = await create({ title: "Yeni sezon", translations: { title: { en: "New season" } } });
        const { DELETE } = await one();
        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(json.popup.id));
        expect(contentTranslation.table.rows).toHaveLength(0);
    });

    it("refuses a translation of a field that has none", async () => {
        const { status } = await create({ title: "Yeni sezon", translations: { link: { en: "https://evil.example" } } });
        expect(status).toBe(400);
        expect(popup.table.rows).toHaveLength(0);
    });
});
