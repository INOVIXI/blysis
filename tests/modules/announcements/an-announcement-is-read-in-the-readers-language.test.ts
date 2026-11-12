// @vitest-environment node
/**
 * An announcement the admin wrote once per language is read in the reader's.
 *
 * The title and the message stay in their columns as the admin typed them,
 * the original; a translation is a `ContentTranslation` row saved in the
 * same transaction. The banner asks with the page's language, and a reader
 * whose language has no translation reads the original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const session: { value: { user: { id: string } } | null } = { value: { user: { id: "admin" } } };
const body: { value: unknown } = { value: {} };

const announcement = fakeTable(() => ({
    type: "info", isActive: true, dismissible: true, includePages: null, excludePages: null,
    startsAt: null, endsAt: null, publishAt: null, createdAt: new Date(),
}));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = { announcement, contentTranslation, activityFeedItem: { create: async () => ({}) } };
db.$transaction = fakeTransaction(db, [announcement.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        isAdmin: async () => true,
        logActivity: async () => {},
        readJsonBody: async () => body.value,
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => session.value }));
vi.mock("@/core/sdk", () => ({ doActionAsync: async () => {} }));

const list = () => import("../../../module-sources/announcements/api/route");
const one = () => import("../../../module-sources/announcements/api/[id]/route");
const admin = () => import("../../../module-sources/announcements/api/admin/route");

async function publicRead(locale?: string) {
    const { GET } = await list();
    const url = `https://example.com/api/v1/announcements${locale ? `?locale=${locale}` : ""}`;
    const res = await GET(new Request(url) as never);
    return (await res.json()).announcements as { id: string; title: string; content: string }[];
}

async function create(payload: Record<string, unknown>) {
    body.value = payload;
    const { POST } = await list();
    const res = await POST(new Request("https://example.com/api/v1/announcements", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
    announcement.table.rows = [];
    contentTranslation.table.rows = [];
    session.value = { user: { id: "admin" } };
});

describe("an announcement written in three languages", () => {
    it("is read by each reader in their own, and in the original where theirs is missing", async () => {
        const { status } = await create({
            title: "Sunucu bakımda",
            content: "Saat 20:00'de dönüyoruz",
            translations: { title: { en: "Server maintenance" }, content: { en: "Back at 20:00", de: "Zurück um 20:00" } },
        });
        expect(status).toBe(201);

        expect(await publicRead("tr")).toMatchObject([{ title: "Sunucu bakımda", content: "Saat 20:00'de dönüyoruz" }]);
        expect(await publicRead("en")).toMatchObject([{ title: "Server maintenance", content: "Back at 20:00" }]);
        expect(await publicRead("de")).toMatchObject([{ title: "Sunucu bakımda", content: "Zurück um 20:00" }]);
        expect(await publicRead("fr")).toMatchObject([{ title: "Sunucu bakımda", content: "Saat 20:00'de dönüyoruz" }]);
        // An integrator that never names a language reads the column, as before.
        expect(await publicRead()).toMatchObject([{ title: "Sunucu bakımda" }]);
    });

    it("keeps the original in the column, where search and exports read it", async () => {
        await create({ title: "Sunucu bakımda", content: "Metin", translations: { title: { en: "Server maintenance" } } });
        expect(announcement.table.rows[0]).toMatchObject({ title: "Sunucu bakımda", content: "Metin" });
    });

    it("is handed to the admin's editor with every language", async () => {
        const { json } = await create({ title: "Bakım", content: "Metin", translations: { title: { en: "Maintenance" } } });
        const { GET } = await admin();
        const res = await GET();
        const rows = (await res.json()).announcements;
        expect(rows).toEqual([expect.objectContaining({ id: json.announcement.id, translations: { title: { en: "Maintenance" } } })]);
    });

    it("is edited language by language: a field it sends is replaced, one it does not is kept", async () => {
        const { json } = await create({
            title: "Bakım", content: "Metin",
            translations: { title: { en: "Maintenance" }, content: { en: "Text" } },
        });
        body.value = { title: "Bakım bitti", translations: { title: { de: "Wartung beendet" } } };
        const { PATCH } = await one();
        const res = await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(json.announcement.id));
        expect(res.status).toBe(200);

        expect(await publicRead("en")).toMatchObject([{ title: "Bakım bitti", content: "Text" }]);
        expect(await publicRead("de")).toMatchObject([{ title: "Wartung beendet", content: "Metin" }]);
    });

    it("takes its translations with it when it is deleted", async () => {
        const { json } = await create({ title: "Bakım", content: "Metin", translations: { title: { en: "Maintenance" } } });
        await create({ title: "Diğer", content: "Metin", translations: { title: { en: "Other" } } });
        const { DELETE } = await one();
        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(json.announcement.id));
        expect(contentTranslation.table.rows.map((r) => r.text)).toEqual(["Other"]);
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status } = await create({ title: "Bakım", content: "Metin", translations: { title: { en: "x".repeat(201) } } });
        expect(status).toBe(400);
        expect(announcement.table.rows).toHaveLength(0);
        expect(contentTranslation.table.rows).toHaveLength(0);
    });
});
