import type { PrismaClient } from "@prisma/client";
import { locales } from "@/core/lib/i18n/config";
import type { LanguageTexts } from "@/core/lib/i18n/translatable-text";

/**
 * A module record's text in the reader's language.
 *
 * A product name or a page title is a column holding what the admin typed.
 * That column stays exactly as it is, the original, so search, sorting, old
 * rows, exports and every API that reads it keep working, and a translation
 * of one field into one language is a row of core's `ContentTranslation`
 * table beside it. The rule for which text a reader gets is phase one's
 * (`textFor`): their own translation when it holds anything but blanks, and
 * otherwise the original.
 *
 * Every function takes the database it writes to, so a module saves a record
 * and its translations in one transaction by handing over its `tx`, and a
 * test hands over an in-memory table.
 * `a-record-keeps-its-words-in-every-language` holds the behaviour.
 */

/** Whose records these are: the module's id and its word for the kind. */
export interface ContentKind {
    owner: string;
    entity: string;
}

/** Each field's translations, by language code. */
export type ContentTranslations = Record<string, LanguageTexts>;

/** The client or the transaction the record is written in. */
type Db = Pick<PrismaClient, "contentTranslation">;

const KNOWN: ReadonlySet<string> = new Set(locales);

/**
 * Every translation of these records, one query for all of them: the
 * admin's editor shows every language, and a list of two hundred rows is
 * still one round trip.
 */
export async function readContentTranslations(
    db: Db,
    kind: ContentKind,
    recordIds: string[],
): Promise<Map<string, ContentTranslations>> {
    const out = new Map<string, ContentTranslations>();
    if (recordIds.length === 0) return out;
    const rows = await db.contentTranslation.findMany({
        where: { owner: kind.owner, entity: kind.entity, recordId: { in: recordIds } },
        select: { recordId: true, field: true, locale: true, text: true },
    });
    for (const row of rows) {
        const record = out.get(row.recordId) ?? {};
        (record[row.field] ??= {})[row.locale] = row.text;
        out.set(row.recordId, record);
    }
    return out;
}

/**
 * The rows with their translations beside them as `translations`, which is
 * what the panel's editor reads back into its language boxes.
 */
export async function attachContentTranslations<T extends { id: string }>(
    db: Db,
    kind: ContentKind,
    rows: T[],
): Promise<(T & { translations: ContentTranslations })[]> {
    const read = await readContentTranslations(db, kind, rows.map((row) => row.id));
    return rows.map((row) => ({ ...row, translations: read.get(row.id) ?? {} }));
}

/**
 * The rows as a reader of `locale` is shown them: each named field replaced
 * by its translation when one holds anything but blanks, and left as the
 * original otherwise. One query for the page. A reader with no language, or
 * one the software does not ship, reads the originals and costs nothing.
 */
export async function translateContent<T extends { id: string }>(
    db: Db,
    kind: ContentKind,
    rows: T[],
    fields: readonly (keyof T & string)[],
    locale: string,
): Promise<T[]> {
    if (rows.length === 0 || fields.length === 0 || !KNOWN.has(locale)) return rows;
    const found = await db.contentTranslation.findMany({
        where: {
            owner: kind.owner,
            entity: kind.entity,
            recordId: { in: rows.map((row) => row.id) },
            field: { in: [...fields] },
            locale,
        },
        select: { recordId: true, field: true, text: true },
    });
    if (found.length === 0) return rows;
    const byRecord = new Map<string, Record<string, string>>();
    for (const row of found) {
        if (row.text.trim() === "") continue;
        const record = byRecord.get(row.recordId) ?? {};
        record[row.field] = row.text;
        byRecord.set(row.recordId, record);
    }
    return rows.map((row) => {
        const own = byRecord.get(row.id);
        if (!own) return row;
        // Only what the row was read with: a shelf reads a product without
        // its description, and must not be handed one by its translation.
        const kept = Object.entries(own).filter(([field]) => Object.prototype.hasOwnProperty.call(row, field));
        return kept.length === 0 ? row : { ...row, ...Object.fromEntries(kept) };
    });
}

/**
 * Replace the translations of each field named in `translations`, and leave
 * every field it does not name alone, the way a PATCH leaves a column it was
 * not sent. A field named with no languages loses them all. Hand it the
 * transaction the record itself is written in.
 */
export async function saveContentTranslations(
    db: Db,
    record: ContentKind & { recordId: string },
    translations: ContentTranslations,
): Promise<void> {
    const fields = Object.keys(translations);
    if (fields.length === 0) return;
    const { owner, entity, recordId } = record;
    await db.contentTranslation.deleteMany({ where: { owner, entity, recordId, field: { in: fields } } });
    const data = fields.flatMap((field) =>
        Object.entries(translations[field])
            .filter((entry): entry is [string, string] => KNOWN.has(entry[0]) && typeof entry[1] === "string" && entry[1].trim() !== "")
            .map(([locale, text]) => ({ owner, entity, recordId, field, locale, text })),
    );
    if (data.length > 0) await db.contentTranslation.createMany({ data });
}

/**
 * Take the translations of deleted records with them. Nothing in the
 * database ties a translation to a module's row, so the module does this in
 * the transaction that deletes the row.
 */
export async function deleteContentTranslations(db: Db, kind: ContentKind, recordIds: string[]): Promise<void> {
    if (recordIds.length === 0) return;
    await db.contentTranslation.deleteMany({
        where: { owner: kind.owner, entity: kind.entity, recordId: { in: recordIds } },
    });
}

export type ContentTranslationsInput =
    | { ok: true; value: ContentTranslations | undefined }
    | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The `translations` an admin's form sent, checked: only the fields named in
 * `limits`, each language held to that field's own limit as its column is,
 * languages the software does not ship and blank texts dropped. Absent is
 * `undefined`, which saves nothing. A field sent with no languages is kept,
 * since that is how its translations are cleared.
 */
export function contentTranslationsInput(value: unknown, limits: Record<string, number>): ContentTranslationsInput {
    if (value === undefined || value === null) return { ok: true, value: undefined };
    if (!isRecord(value)) return { ok: false, error: "translations must be an object" };
    const out: ContentTranslations = {};
    for (const [field, languages] of Object.entries(value)) {
        const limit = limits[field];
        if (limit === undefined) return { ok: false, error: `"${field}" is not translated` };
        if (!isRecord(languages)) return { ok: false, error: `translations of "${field}" must be an object` };
        const kept: LanguageTexts = {};
        for (const [locale, text] of Object.entries(languages)) {
            if (typeof text !== "string") return { ok: false, error: `a translation of "${field}" must be text` };
            if (!KNOWN.has(locale) || text.trim() === "") continue;
            if (text.length > limit) return { ok: false, error: `a translation of "${field}" exceeds ${limit} characters` };
            kept[locale] = text;
        }
        out[field] = kept;
    }
    return { ok: true, value: out };
}
