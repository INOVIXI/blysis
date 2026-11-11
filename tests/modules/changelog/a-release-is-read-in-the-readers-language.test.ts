// @vitest-environment node
/**
 * A release the admin wrote once per language is read in the reader's.
 *
 * The title, the summary and the long form stay in their columns as the
 * admin typed them, the original; a translation is a `ContentTranslation`
 * row saved in the same transaction. The timeline and a release's own page
 * ask with the reader's language, and one whose language has no translation
 * reads the original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const admin = { value: true };
const body: { value: unknown } = { value: {} };
let nextNumber = 1;

const changelogEntry = fakeTable(() => ({
    number: nextNumber++, isActive: true, publishAt: null, details: null, coverImage: null,
    type: "update", color: "#3b82f6", createdAt: new Date(),
}));
const changelogType = fakeTable(() => ({ isActive: true, order: 0 }));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = {
    changelogEntry, changelogType, contentTranslation,
    activityFeedItem: { create: async () => ({}) },
};
db.$transaction = fakeTransaction(db, [changelogEntry.table, contentTranslation.table]);

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
vi.mock("@/core/sdk", () => ({ doActionAsync: async () => {} }));

const list = () => import("../../../module-sources/changelog/api/route");
const one = () => import("../../../module-sources/changelog/api/[id]/route");
const page = () => import("../../../module-sources/changelog/api/entry/[number]/route");
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function read(query = "") {
    const { GET } = await list();
    const res = await GET(new Request(`https://example.com/api/v1/changelog${query}`) as never);
    return { status: res.status, entries: (await res.json()).entries as Record<string, unknown>[] };
}

const publicRead = async (locale?: string) => (await read(locale ? `?locale=${locale}` : "")).entries;

async function readPage(number: number, locale: string) {
    const { GET } = await page();
    const res = await GET(new Request(`https://example.com/api/v1/changelog/entry/${number}?locale=${locale}`), { params: Promise.resolve({ number: String(number) }) });
    return (await res.json()).entry as Record<string, unknown>;
}

async function create(payload: Record<string, unknown>) {
    body.value = { version: "1.0", ...payload };
    const { POST } = await list();
    const res = await POST(new Request("https://example.com/api/v1/changelog", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

beforeEach(() => {
    changelogEntry.table.rows = [];
    contentTranslation.table.rows = [];
    admin.value = true;
});

describe("a release written in three languages", () => {
    it("is on the timeline for each reader in their own, and in the original where theirs is missing", async () => {
        const { status } = await create({
            title: "Yeni harita", content: "<p>Çöl eklendi</p>",
            translations: { title: { en: "New map" }, content: { en: "<p>Desert added</p>", de: "<p>Wüste hinzugefügt</p>" } },
        });
        expect(status).toBe(201);

        expect(await publicRead("tr")).toMatchObject([{ title: "Yeni harita", content: "<p>Çöl eklendi</p>" }]);
        expect(await publicRead("en")).toMatchObject([{ title: "New map", content: "<p>Desert added</p>" }]);
        expect(await publicRead("de")).toMatchObject([{ title: "Yeni harita", content: "<p>Wüste hinzugefügt</p>" }]);
        expect(await publicRead()).toMatchObject([{ title: "Yeni harita" }]);
        expect(changelogEntry.table.rows[0]).toMatchObject({ title: "Yeni harita", content: "<p>Çöl eklendi</p>" });
    });

    it("has its own page read in the reader's language", async () => {
        await create({
            title: "Yeni harita", content: "<p>Çöl</p>", details: "<p>Uzun anlatım</p>",
            translations: { title: { en: "New map" }, details: { en: "<p>The long story</p>" } },
        });
        const number = changelogEntry.table.rows[0].number as number;
        expect(await readPage(number, "en")).toMatchObject({ title: "New map", content: "<p>Çöl</p>", details: "<p>The long story</p>" });
        expect(await readPage(number, "tr")).toMatchObject({ title: "Yeni harita", details: "<p>Uzun anlatım</p>" });
        expect(await readPage(number, "de")).toMatchObject({ title: "Yeni harita", details: "<p>Uzun anlatım</p>" });
    });

    it("is handed to the admin's editor with every language, a scheduled one too, and only to an admin", async () => {
        const { json } = await create({ title: "Yeni harita", content: "x", translations: { title: { en: "New map" } } });
        changelogEntry.table.rows[0].publishAt = new Date(Date.now() + 86_400_000);
        const { entries } = await read("?scope=admin");
        expect(entries).toEqual([expect.objectContaining({ id: json.entry.id, translations: { title: { en: "New map" } } })]);

        admin.value = false;
        expect((await read("?scope=admin")).status).toBe(403);
    });

    it("is edited language by language: a field it sends is replaced, one it does not is kept", async () => {
        const { json } = await create({
            title: "Yeni harita", content: "Metin",
            translations: { title: { en: "New map" }, content: { en: "Text" } },
        });
        body.value = { title: "Yeni çöl", translations: { title: { de: "Neue Wüste" } } };
        const { PATCH } = await one();
        const res = await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(json.entry.id));
        expect(res.status).toBe(200);

        expect(await publicRead("en")).toMatchObject([{ title: "Yeni çöl", content: "Text" }]);
        expect(await publicRead("de")).toMatchObject([{ title: "Neue Wüste", content: "Metin" }]);
    });

    it("takes its translations with it when it is deleted", async () => {
        const { json } = await create({ title: "Yeni harita", content: "x", translations: { title: { en: "New map" } } });
        await create({ title: "Düzeltme", content: "x", translations: { title: { en: "Fix" } } });
        const { DELETE } = await one();
        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(json.entry.id));
        expect(contentTranslation.table.rows.map((r) => r.text)).toEqual(["Fix"]);
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status } = await create({ title: "Yeni harita", content: "x", translations: { title: { en: "x".repeat(201) } } });
        expect(status).toBe(400);
        expect(changelogEntry.table.rows).toHaveLength(0);
        expect(contentTranslation.table.rows).toHaveLength(0);
    });
});
