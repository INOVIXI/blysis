// @vitest-environment node
/**
 * A trophy's name and description, written once per language, are read in
 * the reader's.
 *
 * The columns keep what the admin typed, the original; a translation is a
 * `ContentTranslation` row saved in the same transaction. The trophy page
 * asks with the reader's language, the endpoints with `?locale=`, and a
 * language with no translation reads the original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const session: { value: { user: { id: string } } | null } = { value: { user: { id: "admin" } } };
const body: { value: unknown } = { value: {} };

const trophy = fakeTable(() => ({
    icon: null, color: null, points: 0, awardOn: null, ruleType: "event-count", ruleEvent: null, ruleThreshold: 1,
    rules: null, rulesMode: "all", isActive: true, createdAt: new Date(),
}));
const userTrophy = fakeTable(() => ({ awardedAt: new Date() }));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = { trophy, userTrophy, contentTranslation };
db.$transaction = fakeTransaction(db, [trophy.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        isAdmin: async () => true,
        invalidate: async () => {},
        logActivity: async () => {},
        readJsonBody: async () => body.value,
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => session.value }));

const publicList = () => import("@/modules/trophies/api/route");
const adminList = () => import("@/modules/trophies/api/admin/route");
const adminOne = () => import("@/modules/trophies/api/admin/[id]/route");
const mine = () => import("@/modules/trophies/api/me/route");
const reader = () => import("@/modules/trophies/lib/read-trophies");

async function publicRead(lang?: string) {
    const { GET } = await publicList();
    const res = await GET(new Request(`https://example.com/api/v1/trophies${lang ? `?locale=${lang}` : ""}`) as never);
    return (await res.json()).trophies as { id: string; name: string; description: string | null }[];
}

async function create(payload: Record<string, unknown>) {
    body.value = payload;
    const { POST } = await adminList();
    const res = await POST(new Request("https://example.com/api/v1/admin/trophies", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
    trophy.table.rows = [];
    userTrophy.table.rows = [];
    contentTranslation.table.rows = [];
    session.value = { user: { id: "admin" } };
});

describe("a trophy written in three languages", () => {
    it("is read by each reader in their own, and in the original where theirs is missing", async () => {
        const { status } = await create({
            name: "İlk konu",
            description: "Forumda ilk konunu açtın.",
            translations: { name: { en: "First topic" }, description: { en: "You started your first topic.", de: "Du hast dein erstes Thema eröffnet." } },
        });
        expect(status).toBe(201);

        expect(await publicRead("tr")).toMatchObject([{ name: "İlk konu", description: "Forumda ilk konunu açtın." }]);
        expect(await publicRead("en")).toMatchObject([{ name: "First topic", description: "You started your first topic." }]);
        expect(await publicRead("de")).toMatchObject([{ name: "İlk konu", description: "Du hast dein erstes Thema eröffnet." }]);
        expect(await publicRead()).toMatchObject([{ name: "İlk konu" }]);
        expect(trophy.table.rows[0]).toMatchObject({ name: "İlk konu" });
    });

    it("is drawn by the trophy page in the page's language", async () => {
        await create({ name: "İlk konu", translations: { name: { en: "First topic" } } });
        const { readTrophies } = await reader();
        expect(await readTrophies("en")).toMatchObject([{ name: "First topic" }]);
        expect(await readTrophies("fr")).toMatchObject([{ name: "İlk konu" }]);
    });

    it("is listed on a member's profile in their language", async () => {
        const { json } = await create({ name: "İlk konu", translations: { name: { en: "First topic" } } });
        userTrophy.table.rows.push({ id: "ut1", userId: "admin", trophyId: json.trophy.id, awardedAt: new Date(), trophy: trophy.table.rows[0] });
        const { GET } = await mine();
        const read = async (lang: string) =>
            (await (await GET(new Request(`https://example.com/api/v1/me/trophies?locale=${lang}`) as never)).json()).earned;
        expect(await read("en")).toMatchObject([{ trophy: { name: "First topic" } }]);
        expect(await read("de")).toMatchObject([{ trophy: { name: "İlk konu" } }]);
    });

    it("is handed to the editor with every language", async () => {
        await create({ name: "İlk konu", translations: { name: { en: "First topic" } } });
        const { GET } = await adminList();
        expect((await (await GET()).json()).trophies).toEqual([expect.objectContaining({ translations: { name: { en: "First topic" } } })]);
    });

    it("is edited language by language, and takes its translations with it when deleted", async () => {
        const { json } = await create({
            name: "İlk konu", description: "Metin",
            translations: { name: { en: "First topic" }, description: { en: "Text" } },
        });
        body.value = { name: "İlk başlık", translations: { name: { de: "Erstes Thema" } } };
        const { PATCH, DELETE } = await adminOne();
        expect((await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(json.trophy.id))).status).toBe(200);
        expect(await publicRead("en")).toMatchObject([{ name: "İlk başlık", description: "Text" }]);
        expect(await publicRead("de")).toMatchObject([{ name: "Erstes Thema", description: "Metin" }]);

        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(json.trophy.id));
        expect(contentTranslation.table.rows).toHaveLength(0);
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status } = await create({ name: "Kupa", translations: { name: { en: "x".repeat(101) } } });
        expect(status).toBe(400);
        expect(trophy.table.rows).toHaveLength(0);
    });
});
