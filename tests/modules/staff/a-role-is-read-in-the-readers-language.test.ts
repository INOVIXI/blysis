// @vitest-environment node
/**
 * A staff member's role title, written once per language, is read in the
 * reader's. Their name is a person's name and is never translated.
 *
 * The column keeps what the admin typed, the original; a translation is a
 * `ContentTranslation` row saved in the same transaction. The team page asks
 * with the reader's language, the endpoint and the online strip with
 * `?locale=`, and a language with no translation reads the original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const session: { value: { user: { id: string } } | null } = { value: { user: { id: "admin" } } };
const admin: { value: boolean } = { value: true };
const body: { value: unknown } = { value: {} };

const staffMember = fakeTable(() => ({ userId: null, avatar: null, isActive: true, order: 0 }));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = { staffMember, contentTranslation };
db.$transaction = fakeTransaction(db, [staffMember.table, contentTranslation.table]);

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

const list = () => import("@/modules/staff/api/route");
const one = () => import("@/modules/staff/api/[id]/route");
const reader = () => import("@/modules/staff/lib/read-staff");

async function publicRead(lang?: string) {
    const { GET } = await list();
    const res = await GET(new Request(`https://example.com/api/v1/staff${lang ? `?locale=${lang}` : ""}`) as never);
    return (await res.json()).members as { id: string; name: string; role: string }[];
}

async function create(payload: Record<string, unknown>) {
    body.value = payload;
    const { POST } = await list();
    const res = await POST(new Request("https://example.com/api/v1/staff", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
    staffMember.table.rows = [];
    contentTranslation.table.rows = [];
    session.value = { user: { id: "admin" } };
    admin.value = true;
});

describe("a role written in three languages", () => {
    it("is read by each reader in their own, and in the original where theirs is missing", async () => {
        const { status } = await create({ name: "Mirhan", role: "Kurucu", translations: { role: { en: "Founder" } } });
        expect(status).toBe(201);

        expect(await publicRead("tr")).toMatchObject([{ name: "Mirhan", role: "Kurucu" }]);
        expect(await publicRead("en")).toMatchObject([{ name: "Mirhan", role: "Founder" }]);
        expect(await publicRead("de")).toMatchObject([{ name: "Mirhan", role: "Kurucu" }]);
        expect(await publicRead()).toMatchObject([{ role: "Kurucu" }]);
        expect(staffMember.table.rows[0]).toMatchObject({ role: "Kurucu" });
    });

    it("is drawn by the team page in the page's language", async () => {
        await create({ name: "Mirhan", role: "Kurucu", translations: { role: { en: "Founder" } } });
        const { readStaff } = await reader();
        expect(await readStaff(false, "en")).toMatchObject([{ role: "Founder" }]);
        expect(await readStaff(false, "fr")).toMatchObject([{ role: "Kurucu" }]);
    });

    it("refuses a translated name: a name is a person's, not prose", async () => {
        const { status } = await create({ name: "Mirhan", role: "Kurucu", translations: { name: { en: "Mirhan EN" } } });
        expect(status).toBe(400);
        expect(staffMember.table.rows).toHaveLength(0);
    });

    it("is handed to the editor with every language, a switched-off member too, and to nobody else", async () => {
        const { json } = await create({ name: "Mirhan", role: "Kurucu", translations: { role: { en: "Founder" } } });
        staffMember.table.rows[0].isActive = false;
        const { GET } = await list();
        const res = await GET(new Request("https://example.com/api/v1/staff?scope=admin") as never);
        expect((await res.json()).members).toEqual([expect.objectContaining({ id: json.member.id, translations: { role: { en: "Founder" } } })]);

        admin.value = false;
        expect((await GET(new Request("https://example.com/api/v1/staff?scope=admin") as never)).status).toBe(403);
    });

    it("is edited language by language, and takes its translations with it when deleted", async () => {
        const { json } = await create({ name: "Mirhan", role: "Kurucu", translations: { role: { en: "Founder" } } });
        body.value = { role: "Yönetici", translations: { role: { de: "Verwalter" } } };
        const { PATCH, DELETE } = await one();
        expect((await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(json.member.id))).status).toBe(200);
        expect(await publicRead("en")).toMatchObject([{ role: "Yönetici" }]);
        expect(await publicRead("de")).toMatchObject([{ role: "Verwalter" }]);

        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(json.member.id));
        expect(contentTranslation.table.rows).toHaveLength(0);
    });
});
