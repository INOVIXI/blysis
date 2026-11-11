// @vitest-environment node
/**
 * A source's title, written once per language, is read in the reader's.
 *
 * The title is the operator's heading for a list a theme draws; the table,
 * the columns and the rows are the other database's and are never
 * translated. The column keeps what the admin typed, the original; a
 * translation is a `ContentTranslation` row saved in the same transaction,
 * and `GET /external-data?slug=&locale=` reads it in the reader's language
 * with the original where theirs is missing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";
import { DEFAULT_CONNECTION_KEY } from "@/modules/external-data/lib/connection";

const body: { value: unknown } = { value: {} };

const externalSource = fakeTable(() => ({ settingKey: "", orderBy: "", descending: true, rowLimit: 20, cacheSeconds: 60, isActive: true }));
const setting = fakeTable(() => ({}), "key");
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = { externalSource, setting, contentTranslation };
db.$transaction = fakeTransaction(db, [externalSource.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        isAdmin: async () => true,
        logActivity: async () => {},
        readJsonBody: async () => body.value,
        cached: async (_key: string, _ms: number, read: () => Promise<unknown>) => read(),
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin" } }) }));
vi.mock("@/modules/external-data/lib/read", () => ({ readExternalList: async () => ({ rows: [{ name: "Steve", kills: 3 }] }) }));

const admin = () => import("@/modules/external-data/api/admin/sources/route");
const reader = () => import("@/modules/external-data/api/sources/route");

async function save(payload: Record<string, unknown>) {
    body.value = { slug: "top", table: "stats", columns: ["name", "kills"], ...payload };
    const { PUT } = await admin();
    const res = await PUT(new Request("https://example.com", { method: "PUT" }) as never);
    return { status: res.status, json: await res.json() };
}

async function publicRead(lang: string) {
    const { GET } = await reader();
    const { NextRequest } = await import("next/server");
    return (await (await GET(new NextRequest(`https://example.com/api/v1/external-data?slug=top&locale=${lang}`))).json()) as { title: string; columns: string[] };
}

beforeEach(() => {
    externalSource.table.rows = [];
    contentTranslation.table.rows = [];
    setting.table.rows = [{ key: DEFAULT_CONNECTION_KEY, value: "postgres://example" }];
});

describe("a source titled in three languages", () => {
    it("is read by each reader in their own, and in the original where theirs is missing", async () => {
        const { status } = await save({ title: "En çok öldürenler", translations: { title: { en: "Top killers" } } });
        expect(status).toBe(200);

        expect(await publicRead("tr")).toMatchObject({ title: "En çok öldürenler", columns: ["name", "kills"] });
        expect(await publicRead("en")).toMatchObject({ title: "Top killers", columns: ["name", "kills"] });
        expect(await publicRead("de")).toMatchObject({ title: "En çok öldürenler" });
        expect(externalSource.table.rows[0]).toMatchObject({ title: "En çok öldürenler" });
    });

    it("is handed to the editor with every language, edited language by language, and takes them when deleted", async () => {
        const { json } = await save({ title: "En çok öldürenler", translations: { title: { en: "Top killers" } } });
        const { GET, DELETE } = await admin();
        expect((await (await GET()).json()).sources).toEqual([expect.objectContaining({ translations: { title: { en: "Top killers" } } })]);

        expect((await save({ id: json.source.id, title: "Liderler", translations: { title: { de: "Bestenliste" } } })).status).toBe(200);
        expect(await publicRead("en")).toMatchObject({ title: "Liderler" });
        expect(await publicRead("de")).toMatchObject({ title: "Bestenliste" });

        body.value = { id: json.source.id };
        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never);
        expect(contentTranslation.table.rows).toHaveLength(0);
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status } = await save({ title: "Liderler", translations: { title: { en: "x".repeat(161) } } });
        expect(status).toBe(400);
        expect(externalSource.table.rows).toHaveLength(0);
    });
});
