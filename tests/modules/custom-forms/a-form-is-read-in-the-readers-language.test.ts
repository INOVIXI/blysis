// @vitest-environment node
/**
 * A form the admin wrote once per language is read in the reader's.
 *
 * The title and the description stay in their columns as the admin typed
 * them, and the questions stay in the definition JSON as they were; a
 * translation of the title, of a question's label, help, caption or of one of
 * its choices is a `ContentTranslation` row of the form, saved in the same
 * transaction. A choice is answered with its original wording whatever the
 * reader saw, so the stored answers and the check against the choices do not
 * depend on the language somebody filled the form in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction } from "../game-connect/fake-prisma";

const admin = { value: true };
const body: { value: unknown } = { value: {} };

const customForm = fakeTable(() => ({ isActive: true, createdAt: new Date(), updatedAt: new Date() }));
const customFormSubmission = fakeTable(() => ({ status: "new", createdAt: new Date() }));
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);
const db: Record<string, unknown> = { customForm, customFormSubmission, contentTranslation, activityFeedItem: { create: async () => ({}) } };
db.$transaction = fakeTransaction(db, [customForm.table, contentTranslation.table]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        isAdmin: async () => admin.value,
        readJsonBody: async () => body.value,
        getClientIP: () => "127.0.0.1",
        rateLimitForRoleAsync: async () => true,
        challengeFieldsFrom: () => ({}),
        runChallenge: async () => ({ ok: true }),
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin" } }) }));
vi.mock("@/core/sdk", () => ({
    generateSlug: (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    doActionAsync: async () => {},
}));

const list = () => import("../../../module-sources/custom-forms/api/route");
const one = () => import("../../../module-sources/custom-forms/api/[slug]/route");
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

const QUESTIONS = [
    { name: "nick", type: "text", label: "Oyun adın", required: true, help: "Sunucudaki adın" },
    { name: "role", type: "select", label: "Rol", required: true, options: ["Yapıcı", "Moderatör"] },
    { name: "rules", type: "checkbox", label: "Kurallar", required: false, placeholder: "Kuralları okudum" },
];

interface ReadField { name: string; label: string; help?: string; placeholder?: string; options?: string[]; optionLabels?: string[] }

async function readForm(slug: string, query = "") {
    const { GET } = await one();
    const res = await GET(new Request(`https://example.com/api/v1/forms/${slug}${query}`) as never, params(slug));
    const json = await res.json();
    return { status: res.status, form: json.form as { title: string; description: string | null; fields: ReadField[]; translations?: Record<string, unknown> } };
}

async function create(payload: Record<string, unknown>) {
    body.value = payload;
    const { POST } = await list();
    const res = await POST(new Request("https://example.com/api/v1/forms", { method: "POST" }) as never);
    return { status: res.status, json: await res.json() };
}

async function patch(slug: string, payload: Record<string, unknown>) {
    body.value = payload;
    const { PATCH } = await one();
    const res = await PATCH(new Request("https://example.com", { method: "PATCH" }) as never, params(slug));
    return { status: res.status, json: await res.json() };
}

const TRANSLATED = {
    title: "Başvuru",
    description: "Ekibe katıl",
    fields: QUESTIONS,
    translations: {
        title: { en: "Application", de: "Bewerbung" },
        description: { en: "Join the team" },
        "field.nick.label": { en: "Your in-game name" },
        "field.nick.help": { en: "Your name on the server", de: "Dein Name auf dem Server" },
        "field.role.label": { en: "Role" },
        "field.role.option.Yapıcı": { en: "Builder" },
        "field.rules.placeholder": { en: "I have read the rules" },
    },
};

beforeEach(() => {
    customForm.table.rows = [];
    customFormSubmission.table.rows = [];
    contentTranslation.table.rows = [];
    admin.value = true;
});

describe("a form written in three languages", () => {
    it("is read by each reader in their own, and in the original where theirs is missing", async () => {
        const { status, json } = await create(TRANSLATED);
        expect(status).toBe(201);
        const slug = json.form.slug as string;

        const tr = (await readForm(slug, "?locale=tr")).form;
        expect(tr).toMatchObject({ title: "Başvuru", description: "Ekibe katıl" });
        expect(tr.fields[0]).toMatchObject({ label: "Oyun adın", help: "Sunucudaki adın" });

        const en = (await readForm(slug, "?locale=en")).form;
        expect(en).toMatchObject({ title: "Application", description: "Join the team" });
        expect(en.fields[0]).toMatchObject({ name: "nick", label: "Your in-game name", help: "Your name on the server" });
        expect(en.fields[2]).toMatchObject({ placeholder: "I have read the rules" });
        // The choice keeps its original value, which is what is submitted and
        // stored; only the words beside it are the reader's.
        expect(en.fields[1]).toMatchObject({ label: "Role", options: ["Yapıcı", "Moderatör"], optionLabels: ["Builder", "Moderatör"] });

        const de = (await readForm(slug, "?locale=de")).form;
        expect(de).toMatchObject({ title: "Bewerbung", description: "Ekibe katıl" });
        expect(de.fields[0]).toMatchObject({ label: "Oyun adın", help: "Dein Name auf dem Server" });
        expect(de.fields[1]).toMatchObject({ optionLabels: ["Yapıcı", "Moderatör"] });

        expect((await readForm(slug)).form).toMatchObject({ title: "Başvuru" });
        expect(customForm.table.rows[0]).toMatchObject({ title: "Başvuru", fields: QUESTIONS });
    });

    it("is listed under its title in the reader's language", async () => {
        await create(TRANSLATED);
        const { GET } = await list();
        const res = await GET(new Request("https://example.com/api/v1/forms?locale=en") as never);
        expect((await res.json()).forms).toMatchObject([{ title: "Application", description: "Join the team" }]);
    });

    it("checks an answer against the original choices, whatever language the form was read in", async () => {
        const { json } = await create(TRANSLATED);
        const { POST } = await one();
        body.value = { data: { nick: "Steve", role: "Builder" } };
        const refused = await POST(new Request("https://example.com", { method: "POST" }) as never, params(json.form.slug));
        expect(refused.status).toBe(400);
        body.value = { data: { nick: "Steve", role: "Yapıcı" } };
        const taken = await POST(new Request("https://example.com", { method: "POST" }) as never, params(json.form.slug));
        expect(taken.status).toBe(201);
    });

    it("is handed to the admin's editor with every language, closed or not, and only to an admin", async () => {
        const { json } = await create(TRANSLATED);
        await patch(json.form.slug, { isActive: false });
        const { status, form } = await readForm(json.form.slug, "?scope=admin");
        expect(status).toBe(200);
        expect(form.title).toBe("Başvuru");
        expect(form.translations).toMatchObject({ title: { en: "Application", de: "Bewerbung" }, "field.role.option.Yapıcı": { en: "Builder" } });

        admin.value = false;
        expect((await readForm(json.form.slug, "?scope=admin")).status).toBe(403);
    });

    it("is edited language by language: a field it sends is replaced, one it does not is kept", async () => {
        const { json } = await create(TRANSLATED);
        const { status } = await patch(json.form.slug, { title: "Başvuru formu", translations: { title: { en: "Application form" } } });
        expect(status).toBe(200);
        const en = (await readForm(json.form.slug, "?locale=en")).form;
        expect(en.title).toBe("Application form");
        expect(en.fields[0].label).toBe("Your in-game name");
    });

    it("lets a question's words go with it when the question is removed or renamed", async () => {
        const { json } = await create(TRANSLATED);
        const { status } = await patch(json.form.slug, {
            fields: [{ ...QUESTIONS[0], name: "player", label: "Oyuncu" }, QUESTIONS[1]],
            translations: { "field.player.label": { en: "Player" } },
        });
        expect(status).toBe(200);
        const fieldsLeft = new Set(contentTranslation.table.rows.map((r) => r.field));
        expect(fieldsLeft.has("field.nick.label")).toBe(false);
        expect(fieldsLeft.has("field.rules.placeholder")).toBe(false);
        expect(fieldsLeft.has("field.role.option.Yapıcı")).toBe(true);
        const en = (await readForm(json.form.slug, "?locale=en")).form;
        expect(en.fields.map((f) => f.label)).toEqual(["Player", "Role"]);
    });

    it("takes its translations with it when it is deleted", async () => {
        const { json } = await create(TRANSLATED);
        await create({ title: "Diğer", fields: QUESTIONS, translations: { title: { en: "Other" } } });
        const { DELETE } = await one();
        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never, params(json.form.slug));
        expect(contentTranslation.table.rows.map((r) => r.text)).toEqual(["Other"]);
    });

    it("refuses a translation the definition could not hold, and writes nothing", async () => {
        const tooLong = await create({ ...TRANSLATED, translations: { "field.nick.label": { en: "x".repeat(201) } } });
        expect(tooLong.status).toBe(400);
        const nothingToTranslate = await create({ ...TRANSLATED, translations: { "field.nobody.label": { en: "Ghost" } } });
        expect(nothingToTranslate.status).toBe(400);
        expect(customForm.table.rows).toHaveLength(0);
        expect(contentTranslation.table.rows).toHaveLength(0);
    });
});
