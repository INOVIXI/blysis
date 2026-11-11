// @vitest-environment node
/**
 * A comparison the admin wrote once per language is read in the reader's.
 *
 * The title, the description and every column, group and row label stay in
 * their columns as the admin typed them, the original; a translation is a
 * `ContentTranslation` row of the table, saved in the same transaction as the
 * table. A save lays the columns, groups and rows down again under new ids,
 * so a translation follows its column, group or row to its new id rather than
 * being left on the old one. A reader whose language has no translation
 * reads the original.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeTable, fakeTransaction, matches } from "../game-connect/fake-prisma";

type Row = Record<string, unknown>;

const admin = { value: true };
const body: { value: unknown } = { value: {} };

const comparisonTable = fakeTable(() => ({ isActive: true, order: 0, subjectRef: null, description: null }));
const comparisonColumn = fakeTable(() => ({ subtitle: null, href: null, highlight: false, sourceRef: null }));
const comparisonGroup = fakeTable();
const comparisonRow = fakeTable(() => ({ groupId: null }));
const comparisonCell = fakeTable();
const contentTranslation = fakeTable(() => ({ updatedAt: new Date() }), "id", [["owner", "entity", "recordId", "field", "locale"]]);

const byOrder = (a: Row, b: Row) => (a.order as number) - (b.order as number);

/** The table with its children, the way Prisma's `include` hands it over. */
function withChildren(table: Row) {
    const of = (rows: Row[]) => rows.filter((row) => row.tableId === table.id).sort(byOrder);
    return {
        ...table,
        columns: of(comparisonColumn.table.rows),
        groups: of(comparisonGroup.table.rows),
        rows: of(comparisonRow.table.rows).map((row) => ({
            ...row,
            cells: comparisonCell.table.rows.filter((cell) => cell.rowId === row.id),
        })),
    };
}

const tables = {
    ...comparisonTable,
    // The slug check asks with `NOT`, which the shared fake does not read.
    findFirst: async (args: { where?: Record<string, unknown>; include?: unknown; select?: Record<string, boolean> }) => {
        const { NOT: not, ...where } = args.where ?? {};
        const found = (await comparisonTable.findMany({ ...args, where } as never))
            .find((row) => !not || !matches(row, not as never)) ?? null;
        return found && args.include ? withChildren(found) : found;
    },
    findMany: async (args: { where?: Record<string, unknown>; include?: unknown; select?: Record<string, boolean>; take?: number }) => {
        const found = await comparisonTable.findMany(args as never);
        return args.include ? found.map(withChildren) : found;
    },
};

const db: Record<string, unknown> = {
    comparisonTable: tables, comparisonColumn, comparisonGroup, comparisonRow, comparisonCell, contentTranslation,
};
db.$transaction = fakeTransaction(db, [
    comparisonTable.table, comparisonColumn.table, comparisonGroup.table, comparisonRow.table, comparisonCell.table, contentTranslation.table,
]);

vi.mock("@/core/sdk/server", async () => {
    const translations = await vi.importActual<typeof import("@/core/lib/content-translations")>("@/core/lib/content-translations");
    return {
        ...translations,
        prisma: db,
        isAdmin: async () => admin.value,
        logActivity: async () => {},
        readJsonBody: async () => body.value,
    };
});
vi.mock("@/core/sdk/auth", () => ({ auth: async () => ({ user: { id: "admin" } }) }));
vi.mock("@/core/sdk", () => ({ applyFiltersAsync: async (_: string, value: unknown) => value }));

const editor = () => import("../../../module-sources/comparison-table/api/admin/tables/route");
const reader = () => import("../../../module-sources/comparison-table/api/tables/route");

interface Drawn {
    title: string;
    description: string | null;
    columns: { label: string }[];
    groups: { label: string | null; rows: { label: string }[] }[];
}

async function read(query: string) {
    const { GET } = await reader();
    const url = new URL(`https://example.com/api/v1/comparison-tables${query}`);
    const res = await GET(Object.assign(new Request(url), { nextUrl: url }) as never);
    return res.json();
}

const drawn = async (locale?: string) => (await read(`?slug=plans${locale ? `&locale=${locale}` : ""}`)).table as Drawn;
const words = (table: Drawn) => ({
    title: table.title,
    description: table.description,
    columns: table.columns.map((column) => column.label),
    groups: table.groups.map((group) => group.label),
    rows: table.groups.flatMap((group) => group.rows.map((row) => row.label)),
});

async function save(payload: Record<string, unknown>) {
    body.value = payload;
    const { PUT } = await editor();
    const res = await PUT(new Request("https://example.com", { method: "PUT" }) as never);
    return { status: res.status, json: await res.json() };
}

async function stored() {
    const { GET } = await editor();
    const res = await GET();
    return (await res.json()).tables as (Row & {
        translations: Record<string, Record<string, string>>;
        columns: Row[]; groups: Row[]; rows: Row[];
    })[];
}

const PLANS = {
    slug: "plans",
    title: "Paketler",
    description: "Hangisi sana uygun",
    columns: [{ key: "c1", label: "Ücretsiz" }, { key: "c2", label: "VIP" }],
    groups: [{ key: "g1", label: "Depolama" }],
    rows: [{ key: "r1", groupKey: "g1", label: "Ev sayısı" }],
    cells: [],
};

const TRANSLATIONS = {
    title: { en: "Plans", de: "Pakete" },
    description: { en: "Which one suits you" },
    "column.c1.label": { en: "Free", de: "Kostenlos" },
    "group.g1.label": { en: "Storage" },
    "row.r1.label": { en: "Homes", de: "Häuser" },
};

beforeEach(() => {
    for (const fake of [comparisonTable, comparisonColumn, comparisonGroup, comparisonRow, comparisonCell, contentTranslation]) {
        fake.table.rows = [];
    }
    admin.value = true;
});

describe("a comparison written in three languages", () => {
    it("is read by each reader in their own, and in the original where theirs is missing", async () => {
        const { status } = await save({ ...PLANS, translations: TRANSLATIONS });
        expect(status).toBe(200);

        expect(words(await drawn("tr"))).toEqual({
            title: "Paketler", description: "Hangisi sana uygun", columns: ["Ücretsiz", "VIP"], groups: ["Depolama"], rows: ["Ev sayısı"],
        });
        expect(words(await drawn("en"))).toEqual({
            title: "Plans", description: "Which one suits you", columns: ["Free", "VIP"], groups: ["Storage"], rows: ["Homes"],
        });
        expect(words(await drawn("de"))).toEqual({
            title: "Pakete", description: "Hangisi sana uygun", columns: ["Kostenlos", "VIP"], groups: ["Depolama"], rows: ["Häuser"],
        });
        expect(words(await drawn())).toMatchObject({ title: "Paketler", rows: ["Ev sayısı"] });
        expect(comparisonTable.table.rows[0]).toMatchObject({ title: "Paketler" });
    });

    it("is listed under its title in the reader's language", async () => {
        await save({ ...PLANS, translations: TRANSLATIONS });
        expect((await read("?locale=en")).tables).toEqual([{ slug: "plans", title: "Plans", description: "Which one suits you" }]);
    });

    it("is handed to the editor with every language, keyed by the ids the editor is given", async () => {
        await save({ ...PLANS, translations: TRANSLATIONS });
        const [table] = await stored();
        const row = table.rows[0];
        expect(table.translations).toMatchObject({
            title: { en: "Plans", de: "Pakete" },
            [`row.${row.id}.label`]: { en: "Homes", de: "Häuser" },
        });
    });

    it("keeps each translation on its row when a save lays the rows down again", async () => {
        await save({ ...PLANS, translations: TRANSLATIONS });
        const [table] = await stored();
        const oldRow = table.rows[0].id as string;
        // What the editor sends back: the ids it was given as its keys, and
        // one language changed.
        const { status } = await save({
            id: table.id,
            ...PLANS,
            columns: table.columns.map((c) => ({ key: c.id, label: c.label })),
            groups: table.groups.map((g) => ({ key: g.id, label: g.label })),
            rows: [{ key: oldRow, groupKey: table.groups[0].id, label: "Ev sayısı" }],
            translations: { ...table.translations, [`row.${oldRow}.label`]: { en: "Houses" } },
        });
        expect(status).toBe(200);
        expect(words(await drawn("en")).rows).toEqual(["Houses"]);
        expect(words(await drawn("de")).rows).toEqual(["Ev sayısı"]);
        expect(words(await drawn("en")).columns).toEqual(["Free", "VIP"]);
        expect(contentTranslation.table.rows.some((r) => String(r.field).includes(oldRow))).toBe(false);
    });

    it("keeps its translations through a save that names none", async () => {
        await save({ ...PLANS, translations: TRANSLATIONS });
        const [table] = await stored();
        await save({
            id: table.id,
            ...PLANS,
            title: "Paket listesi",
            columns: table.columns.map((c) => ({ key: c.id, label: c.label })),
            groups: table.groups.map((g) => ({ key: g.id, label: g.label })),
            rows: table.rows.map((r) => ({ key: r.id, groupKey: r.groupId, label: r.label })),
        });
        expect(words(await drawn("en"))).toMatchObject({ title: "Plans", columns: ["Free", "VIP"], rows: ["Homes"] });
    });

    it("lets a removed row's words go with it", async () => {
        await save({ ...PLANS, translations: TRANSLATIONS });
        const [table] = await stored();
        await save({ id: table.id, ...PLANS, rows: [], groups: [], columns: table.columns.map((c) => ({ key: c.id, label: c.label })) });
        const fields = contentTranslation.table.rows.map((r) => String(r.field));
        expect(fields.some((f) => f.startsWith("row.") || f.startsWith("group."))).toBe(false);
        expect(fields).toContain("title");
    });

    it("takes its translations with it when it is deleted", async () => {
        const { json } = await save({ ...PLANS, translations: TRANSLATIONS });
        await save({ ...PLANS, slug: "other", translations: { title: { en: "Other" } } });
        body.value = { id: json.id };
        const { DELETE } = await editor();
        await DELETE(new Request("https://example.com", { method: "DELETE" }) as never);
        expect(contentTranslation.table.rows.map((r) => r.text)).toEqual(["Other"]);
    });

    it("refuses a translation the column could not hold, or one with nothing to translate, and writes nothing", async () => {
        expect((await save({ ...PLANS, translations: { "row.r1.label": { en: "x".repeat(201) } } })).status).toBe(400);
        expect((await save({ ...PLANS, translations: { "row.nope.label": { en: "Ghost" } } })).status).toBe(400);
        expect(comparisonTable.table.rows).toHaveLength(0);
        expect(contentTranslation.table.rows).toHaveLength(0);
    });
});
