// @vitest-environment node
/**
 * A slide the admin wrote once per language is read in the reader's.
 *
 * The title and the subtitle stay in their columns as the admin typed them,
 * the original; a translation is a `ContentTranslation` row saved in the
 * same transaction. The widget asks with the page's language, and a reader
 * whose language has no translation reads the original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const admin = { value: true };
const body: { value: unknown } = { value: {} };

const sliderItem = fakeTable(() => ({ link: null, order: 0, isActive: true, createdAt: new Date() }));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = { sliderItem, contentTranslation };
db.$transaction = fakeTransaction(db, [sliderItem.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        isAdmin: async () => admin.value,
        readJsonBody: async () => body.value,
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin" } }) }));

const list = () => import("../../../module-sources/slider/api/route");
const one = () => import("../../../module-sources/slider/api/[id]/route");
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function read(query = "") {
    const { GET } = await list();
    const res = await GET(new Request(`https://example.com/api/v1/slider${query}`) as never);
    return { status: res.status, items: (await res.json()).items as Record<string, unknown>[] };
}

async function publicRead(locale?: string) {
    admin.value = false;
    const { items } = await read(locale ? `?locale=${locale}` : "");
    admin.value = true;
    return items;
}

async function create(payload: Record<string, unknown>) {
    body.value = payload;
    const { POST } = await list();
    const res = await POST(new Request("https://example.com/api/v1/slider", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

beforeEach(() => {
    sliderItem.table.rows = [];
    contentTranslation.table.rows = [];
    admin.value = true;
});

describe("a slide written in three languages", () => {
    it("is read by each reader in their own, and in the original where theirs is missing", async () => {
        const { status } = await create({
            title: "Yaz etkinliği", subtitle: "Her gün ödül", image: "/a.png",
            translations: { title: { en: "Summer event" }, subtitle: { en: "Prizes every day", de: "Jeden Tag Preise" } },
        });
        expect(status).toBe(201);

        expect(await publicRead("tr")).toMatchObject([{ title: "Yaz etkinliği", subtitle: "Her gün ödül" }]);
        expect(await publicRead("en")).toMatchObject([{ title: "Summer event", subtitle: "Prizes every day" }]);
        expect(await publicRead("de")).toMatchObject([{ title: "Yaz etkinliği", subtitle: "Jeden Tag Preise" }]);
        expect(await publicRead()).toMatchObject([{ title: "Yaz etkinliği" }]);
        expect(sliderItem.table.rows[0]).toMatchObject({ title: "Yaz etkinliği", subtitle: "Her gün ödül" });
    });

    it("is handed to the admin's editor with every language, and only to an admin", async () => {
        const { json } = await create({ title: "Yaz", image: "/a.png", translations: { title: { en: "Summer" } } });
        const { items } = await read("?scope=admin");
        expect(items).toEqual([expect.objectContaining({ id: json.item.id, translations: { title: { en: "Summer" } } })]);

        admin.value = false;
        expect((await read("?scope=admin")).status).toBe(403);
    });

    it("is edited language by language: a field it sends is replaced, one it does not is kept", async () => {
        const { json } = await create({
            title: "Yaz", subtitle: "Ödül", image: "/a.png",
            translations: { title: { en: "Summer" }, subtitle: { en: "Prizes" } },
        });
        body.value = { title: "Kış", translations: { title: { de: "Winter" } } };
        const { PATCH } = await one();
        const res = await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(json.item.id));
        expect(res.status).toBe(200);

        expect(await publicRead("en")).toMatchObject([{ title: "Kış", subtitle: "Prizes" }]);
        expect(await publicRead("de")).toMatchObject([{ title: "Winter", subtitle: "Ödül" }]);
    });

    it("takes its translations with it when it is deleted", async () => {
        const { json } = await create({ title: "Yaz", image: "/a.png", translations: { title: { en: "Summer" } } });
        await create({ title: "Kış", image: "/b.png", translations: { title: { en: "Winter" } } });
        const { DELETE } = await one();
        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(json.item.id));
        expect(contentTranslation.table.rows.map((r) => r.text)).toEqual(["Winter"]);
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status } = await create({ title: "Yaz", image: "/a.png", translations: { title: { en: "x".repeat(201) } } });
        expect(status).toBe(400);
        expect(sliderItem.table.rows).toHaveLength(0);
        expect(contentTranslation.table.rows).toHaveLength(0);
    });
});
