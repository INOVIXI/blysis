// @vitest-environment node
/**
 * A vote site's name, written once per language, is read in the reader's.
 *
 * The column keeps what the admin typed, the original; a translation is a
 * `ContentTranslation` row saved in the same transaction. The page asks with
 * the reader's language, the endpoint with `?locale=`, and a language with
 * no translation reads the original. The address is never translated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const session: { value: { user: { id: string } } | null } = { value: { user: { id: "admin" } } };
const admin: { value: boolean } = { value: true };
const body: { value: unknown } = { value: {} };

const voteSite = fakeTable(() => ({ icon: null, isActive: true, order: 0, createdAt: new Date() }));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = { voteSite, contentTranslation };
db.$transaction = fakeTransaction(db, [voteSite.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        isAdmin: async () => admin.value,
        readJsonBody: async () => body.value,
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => session.value }));

const list = () => import("@/modules/vote/api/sites/route");
const one = () => import("@/modules/vote/api/sites/[id]/route");
const reader = () => import("@/modules/vote/lib/read-sites");

async function publicRead(lang?: string) {
    const { GET } = await list();
    const res = await GET(new Request(`https://example.com/api/v1/vote/sites${lang ? `?locale=${lang}` : ""}`) as never);
    return (await res.json()).sites as { id: string; name: string; url: string }[];
}

async function create(payload: Record<string, unknown>) {
    body.value = payload;
    const { POST } = await list();
    const res = await POST(new Request("https://example.com/api/v1/vote/sites", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
    voteSite.table.rows = [];
    contentTranslation.table.rows = [];
    session.value = { user: { id: "admin" } };
    admin.value = true;
});

describe("a vote site named in three languages", () => {
    it("is read by each reader in their own, and in the original where theirs is missing", async () => {
        const { status } = await create({
            name: "Türk sunucu listesi",
            url: "https://list.example.com/vote",
            translations: { name: { en: "Turkish server list", de: "" } },
        });
        expect(status).toBe(201);

        expect(await publicRead("tr")).toMatchObject([{ name: "Türk sunucu listesi", url: "https://list.example.com/vote" }]);
        expect(await publicRead("en")).toMatchObject([{ name: "Turkish server list", url: "https://list.example.com/vote" }]);
        expect(await publicRead("de")).toMatchObject([{ name: "Türk sunucu listesi" }]);
        expect(await publicRead()).toMatchObject([{ name: "Türk sunucu listesi" }]);
        expect(voteSite.table.rows[0]).toMatchObject({ name: "Türk sunucu listesi" });
    });

    it("is drawn by the server page in the page's language", async () => {
        await create({ name: "Liste", url: "https://l.example.com", translations: { name: { en: "List" } } });
        const { readVoteSites } = await reader();
        expect(await readVoteSites("en")).toMatchObject([{ name: "List" }]);
        expect(await readVoteSites("fr")).toMatchObject([{ name: "Liste" }]);
    });

    it("is handed to the editor with every language, a switched-off site too, and to nobody else", async () => {
        const { json } = await create({ name: "Liste", url: "https://l.example.com", translations: { name: { en: "List" } } });
        voteSite.table.rows[0].isActive = false;
        const { GET } = await list();
        const res = await GET(new Request("https://example.com/api/v1/vote/sites?scope=admin") as never);
        expect((await res.json()).sites).toEqual([expect.objectContaining({ id: json.site.id, translations: { name: { en: "List" } } })]);

        admin.value = false;
        expect((await GET(new Request("https://example.com/api/v1/vote/sites?scope=admin") as never)).status).toBe(403);
    });

    it("is edited language by language, and takes its translations with it when deleted", async () => {
        const { json } = await create({ name: "Liste", url: "https://l.example.com", translations: { name: { en: "List" } } });
        body.value = { translations: { name: { de: "Liste DE" } } };
        const { PATCH, DELETE } = await one();
        expect((await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(json.site.id))).status).toBe(200);
        expect(await publicRead("en")).toMatchObject([{ name: "Liste" }]);
        expect(await publicRead("de")).toMatchObject([{ name: "Liste DE" }]);

        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(json.site.id));
        expect(contentTranslation.table.rows).toHaveLength(0);
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status } = await create({ name: "Liste", url: "https://l.example.com", translations: { name: { en: "x".repeat(101) } } });
        expect(status).toBe(400);
        expect(voteSite.table.rows).toHaveLength(0);
    });
});
