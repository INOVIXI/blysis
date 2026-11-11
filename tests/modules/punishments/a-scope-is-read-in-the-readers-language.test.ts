// @vitest-environment node
/**
 * A scope's name, written once per language, is read in the reader's.
 *
 * A scope is the operator's word for a place, "Survival" or "Skyblock", and
 * it is drawn on the public record as a tab and beside each entry. The column
 * keeps what the admin typed, the original; a translation is a
 * `ContentTranslation` row saved in the same transaction. The record asks
 * with the reader's language, and a language with no translation reads the
 * original. The key a reporting system sends is never translated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const body: { value: unknown } = { value: {} };

const punishmentScope = fakeTable(() => ({ matchKey: null, restrictsSite: false, order: 0, isActive: true, createdAt: new Date() }));
const punishment = fakeTable(() => ({ type: "ban", reason: null, expiresAt: null, liftedAt: null, scopeKey: null, createdAt: new Date() }));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);

// The record reads each entry with its scope on it, and the in-memory table
// knows no relations, so the scope is joined here the way Prisma would.
const punishmentRows = punishment.findMany.getMockImplementation()!;
type PunishmentRead = Parameters<typeof punishmentRows>[0] & { include?: { scope?: unknown }; skip?: number };
punishment.findMany.mockImplementation(async (args: PunishmentRead = {}) => {
    const rows = await punishmentRows(args);
    if (!args.include?.scope) return rows;
    return rows.map((row) => {
        const scope = punishmentScope.table.rows.find((s) => s.id === row.scopeId);
        return { ...row, scope: scope ? { id: scope.id, name: scope.name } : null };
    });
});

const db: Record<string, unknown> = {
    punishmentScope,
    punishment: { ...punishment, groupBy: async () => [] },
    contentTranslation,
};
db.$transaction = fakeTransaction(db, [punishmentScope.table, punishment.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        pageParams: (await vi.importActual<typeof import("@/core/lib/page-params")>("@/core/lib/page-params")).pageParams,
        prisma: db,
        isAdmin: async () => true,
        logActivity: async () => {},
        readJsonBody: async () => body.value,
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin" } }) }));

const scopes = () => import("@/modules/punishments/api/scopes/route");
const record = () => import("@/modules/punishments/api/route");

async function save(payload: Record<string, unknown>) {
    body.value = payload;
    const { PUT } = await scopes();
    const res = await PUT(new Request("https://example.com/api/v1/punishments/scopes", { method: "PUT" }) as never);
    return { status: res.status, json: await res.json() };
}

async function publicRead(lang: string) {
    const { GET } = await record();
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest(`https://example.com/api/v1/punishments?locale=${lang}`));
    return (await res.json()) as { punishments: { scope: { name: string } | null }[]; scopes: { name: string }[] };
}

beforeEach(() => {
    punishmentScope.table.rows = [];
    punishment.table.rows = [];
    contentTranslation.table.rows = [];
});

describe("a scope named in three languages", () => {
    it("is drawn on the public record in each reader's language, and the original where theirs is missing", async () => {
        const { status, json } = await save({ name: "Hayatta Kalma", matchKey: "srv-1", translations: { name: { en: "Survival" } } });
        expect(status).toBe(200);
        punishment.table.rows.push({ id: "p1", playerName: "Steve", type: "ban", scopeId: json.scope.id, createdAt: new Date(), expiresAt: null, liftedAt: null });

        expect(await publicRead("tr")).toMatchObject({ punishments: [{ scope: { name: "Hayatta Kalma" } }], scopes: [{ name: "Hayatta Kalma" }] });
        expect(await publicRead("en")).toMatchObject({ punishments: [{ scope: { name: "Survival" } }], scopes: [{ name: "Survival" }] });
        expect(await publicRead("de")).toMatchObject({ punishments: [{ scope: { name: "Hayatta Kalma" } }], scopes: [{ name: "Hayatta Kalma" }] });
        expect(punishmentScope.table.rows[0]).toMatchObject({ name: "Hayatta Kalma", matchKey: "srv-1" });
    });

    it("is drawn by the server page in the page's language", async () => {
        const { json } = await save({ name: "Hayatta Kalma", translations: { name: { en: "Survival" } } });
        punishment.table.rows.push({ id: "p1", playerName: "Steve", type: "ban", scopeId: json.scope.id, createdAt: new Date(), expiresAt: null, liftedAt: null });
        const { readPunishments } = await import("@/modules/punishments/lib/read-punishments");
        expect((await readPunishments({ page: 1, locale: "en" })).scopes).toMatchObject([{ name: "Survival" }]);
    });

    it("is handed to the editor with every language, edited language by language, and takes them when deleted", async () => {
        const { json } = await save({ name: "Hayatta Kalma", translations: { name: { en: "Survival" } } });
        const { GET, DELETE } = await scopes();
        expect((await (await GET()).json()).scopes).toEqual([expect.objectContaining({ translations: { name: { en: "Survival" } } })]);

        await save({ id: json.scope.id, name: "Hayatta", translations: { name: { de: "Überleben" } } });
        expect(contentTranslation.table.rows.map((row) => [row.locale, row.text])).toEqual([["de", "Überleben"]]);

        body.value = { id: json.scope.id };
        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never);
        expect(contentTranslation.table.rows).toHaveLength(0);
    });

    it("refuses a translation the column could not hold, and writes nothing", async () => {
        const { status } = await save({ name: "Hayatta Kalma", translations: { name: { en: "x".repeat(81) } } });
        expect(status).toBe(400);
        expect(punishmentScope.table.rows).toHaveLength(0);
    });
});
