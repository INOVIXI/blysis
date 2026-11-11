// @vitest-environment node
/**
 * A game server's name and description, written once per language, are read
 * in the reader's.
 *
 * The columns keep what the admin typed, the original; a translation is a
 * `ContentTranslation` row saved in the same transaction. The cards, the
 * widget and the sign-up aside read `GET /servers/status?locale=`, the list
 * `GET /servers?locale=`, and a language with no translation reads the
 * original. The address is never translated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const session: { value: { user: { id: string } } | null } = { value: { user: { id: "admin" } } };
const body: { value: unknown } = { value: {} };

const gameServer = fakeTable(() => ({
    type: "hytale", port: 25565, queryPort: null, rconPort: null, rconPassword: null,
    isDefault: false, isActive: true, order: 0, image: null, createdAt: new Date(), updatedAt: new Date(),
}));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = { gameServer, contentTranslation };
db.$transaction = fakeTransaction(db, [gameServer.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        isAdmin: async () => true,
        encryptSecret: (value: string) => value,
        readJsonBody: async () => body.value,
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => session.value }));

const list = () => import("@/modules/servers/api/route");
const one = () => import("@/modules/servers/api/[id]/route");
const status = () => import("@/modules/servers/api/status/route");

async function read(lang?: string) {
    const { GET } = await list();
    const res = await GET(new Request(`https://example.com/api/v1/servers${lang ? `?locale=${lang}` : ""}`) as never);
    return (await res.json()).servers as { name: string; description: string | null; host: string }[];
}

async function statuses(lang: string) {
    const { GET } = await status();
    const res = await GET(new Request(`https://example.com/api/v1/servers/status?locale=${lang}`) as never);
    return (await res.json()).servers as { name: string; description: string | null; address: string | null }[];
}

async function create(payload: Record<string, unknown>) {
    body.value = payload;
    const { POST } = await list();
    const res = await POST(new Request("https://example.com/api/v1/servers", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
    gameServer.table.rows = [];
    contentTranslation.table.rows = [];
    session.value = { user: { id: "admin" } };
});

describe("a game server named in three languages", () => {
    it("is listed and drawn in each reader's language, and the original where theirs is missing", async () => {
        const { status: code } = await create({
            name: "Hayatta Kalma",
            host: "play.example.com",
            description: "Klasik oyun",
            translations: { name: { en: "Survival" }, description: { en: "The classic game", de: "Das klassische Spiel" } },
        });
        expect(code).toBe(201);

        expect(await read("tr")).toMatchObject([{ name: "Hayatta Kalma", description: "Klasik oyun", host: "play.example.com" }]);
        expect(await read("en")).toMatchObject([{ name: "Survival", description: "The classic game", host: "play.example.com" }]);
        expect(await read("de")).toMatchObject([{ name: "Hayatta Kalma", description: "Das klassische Spiel" }]);
        expect(await read()).toMatchObject([{ name: "Hayatta Kalma" }]);

        expect(await statuses("en")).toMatchObject([{ name: "Survival", description: "The classic game", address: "play.example.com" }]);
        expect(await statuses("fr")).toMatchObject([{ name: "Hayatta Kalma", description: "Klasik oyun" }]);
        expect(gameServer.table.rows[0]).toMatchObject({ name: "Hayatta Kalma", description: "Klasik oyun" });
    });

    it("is handed to the panel with every language", async () => {
        await create({ name: "Hayatta Kalma", host: "h", translations: { name: { en: "Survival" } } });
        const { GET } = await list();
        const res = await GET(new Request("https://example.com/api/v1/servers?scope=admin") as never);
        expect((await res.json()).servers).toEqual([expect.objectContaining({ translations: { name: { en: "Survival" } } })]);
    });

    it("is edited language by language, and takes its translations with it when deleted", async () => {
        const { json } = await create({
            name: "Hayatta Kalma", host: "h", description: "Klasik",
            translations: { name: { en: "Survival" }, description: { en: "Classic" } },
        });
        body.value = { name: "Hayatta", translations: { name: { de: "Überleben" } } };
        const { PATCH, DELETE } = await one();
        expect((await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(json.server.id))).status).toBe(200);
        expect(await read("en")).toMatchObject([{ name: "Hayatta", description: "Classic" }]);
        expect(await read("de")).toMatchObject([{ name: "Überleben", description: "Klasik" }]);

        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(json.server.id));
        expect(contentTranslation.table.rows).toHaveLength(0);
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status: code } = await create({ name: "S", host: "h", translations: { description: { en: "x".repeat(301) } } });
        expect(code).toBe(400);
        expect(gameServer.table.rows).toHaveLength(0);
    });
});
