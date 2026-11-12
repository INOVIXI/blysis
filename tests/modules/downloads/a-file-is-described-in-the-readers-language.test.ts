// @vitest-environment node
/**
 * A download the admin described once per language is read in the reader's.
 *
 * The title, the description and the guide stay in their columns as the
 * admin typed them, the original; a translation is a `ContentTranslation`
 * row saved in the same transaction. The list, its page and the guide ask
 * with the reader's language, and one whose language has no translation
 * reads the original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const admin = { value: true };
const body: { value: unknown } = { value: {} };
let nextNumber = 1;

const download = fakeTable(() => ({
    number: nextNumber++, isActive: true, downloads: 0, coverImage: null, fileSize: null,
    details: null, createdAt: new Date(), updatedAt: new Date(),
}));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = { download, contentTranslation };
db.$transaction = fakeTransaction(db, [download.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        isAdmin: async () => admin.value,
        readJsonBody: async () => body.value,
        rateLimitForRoleAsync: async () => true,
        getClientIP: () => "127.0.0.1",
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin" } }) }));

const list = () => import("../../../module-sources/downloads/api/route");
const one = () => import("../../../module-sources/downloads/api/[id]/route");
const guide = () => import("../../../module-sources/downloads/api/guide/[number]/route");
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function read(query = "") {
    const { GET } = await list();
    const res = await GET(new Request(`https://example.com/api/v1/downloads${query}`) as never);
    return { status: res.status, downloads: (await res.json()).downloads as Record<string, unknown>[] };
}

const publicRead = async (locale?: string) => (await read(locale ? `?locale=${locale}` : "")).downloads;

async function readGuide(number: number, locale: string) {
    const { GET } = await guide();
    const res = await GET(new Request(`https://example.com/api/v1/downloads/guide/${number}?locale=${locale}`), { params: Promise.resolve({ number: String(number) }) });
    return (await res.json()).download as Record<string, unknown>;
}

async function create(payload: Record<string, unknown>) {
    body.value = { fileName: "a.zip", fileUrl: "https://example.com/a.zip", ...payload };
    const { POST } = await list();
    const res = await POST(new Request("https://example.com/api/v1/downloads", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

beforeEach(() => {
    download.table.rows = [];
    contentTranslation.table.rows = [];
    admin.value = true;
});

describe("a download written in three languages", () => {
    it("is listed for each reader in their own, and in the original where theirs is missing", async () => {
        const { status } = await create({
            title: "Başlatıcı", description: "Oyuna girmek için",
            translations: { title: { en: "Launcher" }, description: { en: "To join the game", de: "Zum Spielen" } },
        });
        expect(status).toBe(201);

        expect(await publicRead("tr")).toMatchObject([{ title: "Başlatıcı", description: "Oyuna girmek için" }]);
        expect(await publicRead("en")).toMatchObject([{ title: "Launcher", description: "To join the game" }]);
        expect(await publicRead("de")).toMatchObject([{ title: "Başlatıcı", description: "Zum Spielen" }]);
        expect(await publicRead()).toMatchObject([{ title: "Başlatıcı" }]);
        // The original stays in the column, and the slug follows it.
        expect(download.table.rows[0]).toMatchObject({ title: "Başlatıcı", slug: "ba-lat-c" });
    });

    it("has its guide read in the reader's language", async () => {
        await create({
            title: "Başlatıcı", details: "<p>Önce Java kur.</p>",
            translations: { title: { en: "Launcher" }, details: { en: "<p>Install Java first.</p>" } },
        });
        const number = download.table.rows[0].number as number;
        expect(await readGuide(number, "en")).toMatchObject({ title: "Launcher", details: "<p>Install Java first.</p>" });
        expect(await readGuide(number, "tr")).toMatchObject({ title: "Başlatıcı", details: "<p>Önce Java kur.</p>" });
        expect(await readGuide(number, "de")).toMatchObject({ title: "Başlatıcı", details: "<p>Önce Java kur.</p>" });
    });

    it("is handed to the admin's editor with every language, switched off ones too, and only to an admin", async () => {
        const { json } = await create({ title: "Başlatıcı", translations: { title: { en: "Launcher" } } });
        download.table.rows[0].isActive = false;
        const { downloads } = await read("?scope=admin");
        expect(downloads).toEqual([expect.objectContaining({ id: json.download.id, translations: { title: { en: "Launcher" } } })]);

        admin.value = false;
        expect((await read("?scope=admin")).status).toBe(403);
    });

    it("is edited language by language: a field it sends is replaced, one it does not is kept", async () => {
        const { json } = await create({
            title: "Başlatıcı", description: "Metin",
            translations: { title: { en: "Launcher" }, description: { en: "Text" } },
        });
        body.value = { title: "Yeni başlatıcı", translations: { title: { de: "Neuer Starter" } } };
        const { PATCH } = await one();
        const res = await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(json.download.id));
        expect(res.status).toBe(200);

        expect(await publicRead("en")).toMatchObject([{ title: "Yeni başlatıcı", description: "Text" }]);
        expect(await publicRead("de")).toMatchObject([{ title: "Neuer Starter", description: "Metin" }]);
    });

    it("takes its translations with it when it is deleted", async () => {
        const { json } = await create({ title: "Başlatıcı", translations: { title: { en: "Launcher" } } });
        await create({ title: "Kurallar", translations: { title: { en: "Rules" } } });
        const { DELETE } = await one();
        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(json.download.id));
        expect(contentTranslation.table.rows.map((r) => r.text)).toEqual(["Rules"]);
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status } = await create({ title: "Başlatıcı", translations: { title: { en: "x".repeat(201) } } });
        expect(status).toBe(400);
        expect(download.table.rows).toHaveLength(0);
        expect(contentTranslation.table.rows).toHaveLength(0);
    });
});
