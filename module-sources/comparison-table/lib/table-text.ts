import { prisma, translateContent, type ContentTranslations } from "@/core/sdk/server";

/**
 * A table's words in the reader's language.
 *
 * Every label stays in its column as the operator typed it, and every
 * translation is a row of core's `ContentTranslation` table owned by the
 * table, named by what it translates: `title`, `description`,
 * `column.<id>.label`, `column.<id>.subtitle`, `group.<id>.label` and
 * `row.<id>.label`.
 *
 * Owned by the table rather than by each column or row, because a save lays
 * the columns, groups and rows down again under new ids (`api/admin/tables`
 * says why). A translation keyed to a row would be left on an id that no
 * longer exists; keyed inside the table, a save moves each one to its row's
 * new id in the same transaction, and a reader's whole table is still one
 * query. `a-table-is-read-in-the-readers-language` holds the behaviour.
 */

export const TABLE_TEXT = { owner: "comparison-table", entity: "table" };

/** Each text held to the limit its column is held to. */
const LIMIT = { title: 160, description: 1_000, "column.label": 120, "column.subtitle": 200, "group.label": 120, "row.label": 200 };

const CHILD = /^(column|group|row)\.(.+)\.(label|subtitle)$/;

interface DraftWords {
    columns: { key: string }[];
    groups: { key: string }[];
    rows: { key: string }[];
}

/** What a save of this draft may translate, keyed by the editor's own keys. */
export function tableTextLimits(draft: DraftWords): Record<string, number> {
    const limits: Record<string, number> = { title: LIMIT.title, description: LIMIT.description };
    for (const column of draft.columns) {
        limits[`column.${column.key}.label`] = LIMIT["column.label"];
        limits[`column.${column.key}.subtitle`] = LIMIT["column.subtitle"];
    }
    for (const group of draft.groups) limits[`group.${group.key}.label`] = LIMIT["group.label"];
    for (const row of draft.rows) limits[`row.${row.key}.label`] = LIMIT["row.label"];
    return limits;
}

export interface NewIds {
    column: Map<string, string>;
    group: Map<string, string>;
    row: Map<string, string>;
}

function moved(key: string, ids: NewIds): string | null {
    const child = CHILD.exec(key);
    if (!child) return key === "title" || key === "description" ? key : null;
    const [, kind, id, part] = child;
    const to = ids[kind as keyof NewIds].get(id);
    return to ? `${kind}.${to}.${part}` : null;
}

/**
 * The table's whole set of translations after a save: what it had, moved to
 * the new ids of the columns, groups and rows the draft kept, with whatever
 * the editor sent laid over it. A child the draft dropped takes its words
 * with it. Saved after every one of the table's rows is deleted, so nothing
 * is left on an id that is gone.
 */
export function carriedTranslations(stored: ContentTranslations | undefined, sent: ContentTranslations | undefined, ids: NewIds): ContentTranslations {
    const out: ContentTranslations = {};
    for (const source of [stored ?? {}, sent ?? {}]) {
        for (const [key, languages] of Object.entries(source)) {
            const to = moved(key, ids);
            if (to) out[to] = languages;
        }
    }
    return out;
}

interface StoredTable {
    id: string;
    title: string;
    description: string | null;
    columns: { id: string; label: string; subtitle: string | null }[];
    groups: { id: string; label: string }[];
    rows: { id: string; label: string }[];
}

/**
 * The table as a reader of `locale` is shown it: one query for every word,
 * the reader's translation where it holds anything but blanks and the
 * original otherwise. Without a language it is the table as stored.
 */
export async function translateTable<T extends StoredTable>(table: T, locale: string | undefined): Promise<T> {
    if (!locale) return table;
    const originals: Record<string, string> = { title: table.title };
    if (table.description) originals.description = table.description;
    for (const column of table.columns) {
        originals[`column.${column.id}.label`] = column.label;
        if (column.subtitle) originals[`column.${column.id}.subtitle`] = column.subtitle;
    }
    for (const group of table.groups) originals[`group.${group.id}.label`] = group.label;
    for (const row of table.rows) originals[`row.${row.id}.label`] = row.label;

    // One row of every word, so the whole table is one query.
    const row: Record<string, string> & { id: string } = { ...originals, id: table.id };
    const [words] = await translateContent(prisma, TABLE_TEXT, [row], Object.keys(originals), locale);
    return {
        ...table,
        title: words.title,
        description: table.description ? words.description : table.description,
        columns: table.columns.map((column) => ({
            ...column,
            label: words[`column.${column.id}.label`],
            subtitle: column.subtitle ? words[`column.${column.id}.subtitle`] : column.subtitle,
        })),
        groups: table.groups.map((group) => ({ ...group, label: words[`group.${group.id}.label`] })),
        rows: table.rows.map((row) => ({ ...row, label: words[`row.${row.id}.label`] })),
    };
}
