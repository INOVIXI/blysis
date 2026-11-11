// @vitest-environment node
/**
 * A showcase card the admin wrote once per language is read in the reader's.
 *
 * The heading and the line under it stay in their columns as the admin typed
 * them; a translation is a `ContentTranslation` row saved in the same
 * transaction. The page asks with the reader's language, the endpoint with
 * `?locale=`, and a language with no translation reads the original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const session: { value: { user: { id: string } } | null } = { value: { user: { id: "admin" } } };
const admin: { value: boolean } = { value: true };
const body: { value: unknown } = { value: {} };
const locale: { value: string } = { value: "tr" };

const showcaseCard = fakeTable(() => ({ image: null, href: null, isActive: true, order: 0, createdAt: new Date() }));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = { showcaseCard, contentTranslation };
db.$transaction = fakeTransaction(db, [showcaseCard.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        isAdmin: async () => admin.value,
        logActivity: async () => {},
        readJsonBody: async () => body.value,
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => session.value }));
vi.mock("next-intl/server", () => ({ getLocale: async () => locale.value }));

const list = () => import("../../../module-sources/showcase/api/cards/route");
const one = () => import("../../../module-sources/showcase/api/cards/[id]/route");
const reader = () => import("../../../module-sources/showcase/lib/read-cards");

async function publicRead(lang?: string) {
    const { GET } = await list();
    const res = await GET(new Request(`https://example.com/api/v1/showcase/cards${lang ? `?locale=${lang}` : ""}`) as never);
    return (await res.json()).cards as { id: string; title: string; body: string | null }[];
}

async function create(payload: Record<string, unknown>) {
    body.value = payload;
    const { POST } = await list();
    const res = await POST(new Request("https://example.com/api/v1/showcase/cards", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
    showcaseCard.table.rows = [];
    contentTranslation.table.rows = [];
    session.value = { user: { id: "admin" } };
    admin.value = true;
});

describe("a showcase card written in three languages", () => {
    it("is read by each reader in their own, and in the original where theirs is missing", async () => {
        const { status } = await create({
            title: "Yeni sezon",
            body: "Harita sıfırlandı",
            translations: { title: { en: "New season" }, body: { en: "The map was reset", de: "Die Karte wurde zurückgesetzt" } },
        });
        expect(status).toBe(201);

        expect(await publicRead("tr")).toMatchObject([{ title: "Yeni sezon", body: "Harita sıfırlandı" }]);
        expect(await publicRead("en")).toMatchObject([{ title: "New season", body: "The map was reset" }]);
        expect(await publicRead("de")).toMatchObject([{ title: "Yeni sezon", body: "Die Karte wurde zurückgesetzt" }]);
        expect(await publicRead("fr")).toMatchObject([{ title: "Yeni sezon", body: "Harita sıfırlandı" }]);
        expect(await publicRead()).toMatchObject([{ title: "Yeni sezon" }]);
        expect(showcaseCard.table.rows[0]).toMatchObject({ title: "Yeni sezon", body: "Harita sıfırlandı" });
    });

    it("is drawn by the server page in the page's language", async () => {
        await create({ title: "Yeni sezon", body: "Metin", translations: { title: { en: "New season" } } });
        const { readShowcaseCards } = await reader();
        locale.value = "en";
        expect(await readShowcaseCards(locale.value)).toMatchObject([{ title: "New season", body: "Metin" }]);
        locale.value = "de";
        expect(await readShowcaseCards(locale.value)).toMatchObject([{ title: "Yeni sezon", body: "Metin" }]);
    });

    it("is handed to the editor with every language, a switched-off card too, and to nobody else", async () => {
        const { json } = await create({ title: "Yeni sezon", translations: { title: { en: "New season" } } });
        showcaseCard.table.rows[0].isActive = false;
        const { GET } = await list();
        const res = await GET(new Request("https://example.com/api/v1/showcase/cards?scope=admin") as never);
        expect((await res.json()).cards).toEqual([
            expect.objectContaining({ id: json.card.id, translations: { title: { en: "New season" } } }),
        ]);

        admin.value = false;
        const refused = await GET(new Request("https://example.com/api/v1/showcase/cards?scope=admin") as never);
        expect(refused.status).toBe(403);
    });

    it("is edited language by language, and takes its translations with it when deleted", async () => {
        const { json } = await create({
            title: "Yeni sezon", body: "Metin",
            translations: { title: { en: "New season" }, body: { en: "Text" } },
        });
        body.value = { title: "Sezon", translations: { title: { de: "Saison" } } };
        const { PATCH, DELETE } = await one();
        const res = await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(json.card.id));
        expect(res.status).toBe(200);
        expect(await publicRead("en")).toMatchObject([{ title: "Sezon", body: "Text" }]);
        expect(await publicRead("de")).toMatchObject([{ title: "Saison", body: "Metin" }]);

        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(json.card.id));
        expect(contentTranslation.table.rows).toHaveLength(0);
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status } = await create({ title: "Kart", translations: { title: { en: "x".repeat(121) } } });
        expect(status).toBe(400);
        expect(showcaseCard.table.rows).toHaveLength(0);
        expect(contentTranslation.table.rows).toHaveLength(0);
    });
});
