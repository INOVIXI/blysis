/**
 * A string as the translation editor shows it: one line, whoever ships it.
 *
 * A string can have a row from the source that owns it, one from the theme
 * the site is wearing and one the site edited, and the editor listed each as
 * a line of its own. A line here says what the site says in each language,
 * which source says it, and what it would say without the site's edit, so
 * an operator edits what a visitor reads. `a-string-is-edited-once-whoever-says-it`
 * holds it.
 *
 * Core names no module here. Sources arrive as data, out of a column.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/core/lib/db";
import { FLAG_REVIEW, FLAG_TRANSLATE } from "@/core/lib/i18n/flag-reasons";
import { shippedValue } from "@/core/lib/i18n/shipped-value";
import { THEME_SOURCE_PREFIX, ownerOf, sayingOf, voiceOf } from "@/core/lib/i18n/translation-layers";

export interface LineRef {
    namespace: string;
    key: string;
}

export interface LineRow extends LineRef {
    id: string;
    locale: string;
    module: string;
    value: string;
    isCustom: boolean;
    /** What the row shipped as when the site edited it; see `Translation.basis`. */
    basis?: string | null;
}

/** A string in one language that wants looking at; see `flag-reasons`. */
export interface LineFlag extends LineRef {
    locale: string;
    reason: string;
}

interface Said {
    value: string | null;
    /** The source whose row the site reads. */
    from: string | null;
    isCustom: boolean;
    /** What the site would say without its own edit. */
    shipped: string | null;
    /** An update moved the original under the site's edit: what it said, and says now. */
    review: { was: string; now: string } | null;
    /** The string changed in another language after this one was written. */
    awaiting: boolean;
}

export interface Line extends LineRef {
    /** Where an edit is filed; see `ownerOf`. */
    owner: string;
    /** Every source with a row for the string, lowest voice first. */
    sources: string[];
    locales: Record<string, Said>;
}

/** Rows the site can hear: every module's and core's, and the worn theme's alone. */
export function heardBy(themeId: string): Prisma.TranslationWhereInput {
    return {
        NOT: {
            AND: [
                { module: { startsWith: THEME_SOURCE_PREFIX } },
                { module: { not: `${THEME_SOURCE_PREFIX}${themeId}` } },
            ],
        },
    };
}

/** `heardBy` for a raw query over the `Translation` table. */
export function heardSql(themeId: string): Prisma.Sql {
    return Prisma.sql`NOT ("module" LIKE ${`${THEME_SOURCE_PREFIX}%`} AND "module" <> ${`${THEME_SOURCE_PREFIX}${themeId}`})`;
}

/** Every row the site hears for these strings. */
export async function lineRows(refs: LineRef[], themeId: string, locales?: readonly string[]): Promise<LineRow[]> {
    if (refs.length === 0) return [];
    return prisma.translation.findMany({
        where: {
            AND: [heardBy(themeId), { OR: refs.map((r) => ({ namespace: r.namespace, key: r.key })) }],
            ...(locales ? { locale: { in: [...locales] } } : {}),
        },
        select: { id: true, locale: true, module: true, namespace: true, key: true, value: true, isCustom: true, basis: true },
    });
}

/** What is asked of these strings, in these languages. */
export async function lineFlags(refs: LineRef[], locales: readonly string[]): Promise<LineFlag[]> {
    if (refs.length === 0) return [];
    return prisma.translationFlag.findMany({
        where: { OR: refs.map((r) => ({ namespace: r.namespace, key: r.key })), locale: { in: [...locales] } },
        select: { locale: true, namespace: true, key: true, reason: true },
    });
}

function rowsOf(ref: LineRef, rows: LineRow[]): LineRow[] {
    return rows.filter((r) => r.namespace === ref.namespace && r.key === ref.key);
}

/**
 * What a string says in one language with the site's edits taken away: the
 * highest source that still says something of its own. An edited row has
 * lost what it shipped, so its source is asked.
 */
function beneath(ref: LineRef, rows: LineRow[], locale: string): string | null {
    const highestFirst = rows.filter((r) => r.locale === locale).sort((a, b) => voiceOf(b.module) - voiceOf(a.module) || b.module.localeCompare(a.module));
    for (const row of highestFirst) {
        const original = row.isCustom ? shippedValue(row.module, locale, ref.namespace, ref.key) : row.value;
        if (original !== null) return original;
    }
    return null;
}

/**
 * What an update changed under the site's edit, when the seeder flagged it:
 * the original the edit was written against, and the one shipping now.
 */
function reviewOf(ref: LineRef, rows: LineRow[], locale: string, from: string | null): Said["review"] {
    const edited = rows.find((r) => r.locale === locale && r.module === from && r.isCustom);
    const now = edited ? shippedValue(edited.module, locale, ref.namespace, ref.key) : null;
    if (!edited?.basis || now === null || now === edited.basis) return null;
    return { was: edited.basis, now };
}

export function lineOf(ref: LineRef, all: LineRow[], locales: readonly string[], flags: LineFlag[] = []): Line {
    const rows = rowsOf(ref, all);
    const asked = (locale: string, reason: string) =>
        flags.some((f) => f.namespace === ref.namespace && f.key === ref.key && f.locale === locale && f.reason === reason);
    const sources = [...new Set(rows.map((r) => r.module))].sort((a, b) => voiceOf(a) - voiceOf(b) || a.localeCompare(b));
    return {
        namespace: ref.namespace,
        key: ref.key,
        owner: ownerOf(sources) ?? "core",
        sources,
        locales: Object.fromEntries(locales.map((locale) => {
            const said = sayingOf(rows.filter((r) => r.locale === locale));
            return [locale, {
                value: said?.value ?? null,
                from: said?.from ?? null,
                isCustom: said?.isCustom ?? false,
                shipped: beneath(ref, rows, locale),
                review: asked(locale, FLAG_REVIEW) ? reviewOf(ref, rows, locale, said?.from ?? null) : null,
                awaiting: asked(locale, FLAG_TRANSLATE),
            }];
        })),
    };
}

export type EditOp =
    | { upsert: { locale: string; module: string; value: string; basis: string | null } }
    | { restore: { id: string; value: string } }
    | { drop: { id: string } };

/**
 * The writes that make a string say `value` in one language: the owner's row
 * edited, and any older edit on another source undone, since an edit there
 * would be heard over this one. One that has nothing shipped to go back to is
 * dropped; it was only ever the site's words.
 */
export function editOps(ref: LineRef, owner: string, all: LineRow[], locale: string, value: string): EditOp[] {
    // The original the edit is written against, so an update that ships
    // another one under it can ask for the edit to be looked at again.
    const basis = shippedValue(owner, locale, ref.namespace, ref.key);
    const ops: EditOp[] = [{ upsert: { locale, module: owner, value, basis } }];
    for (const row of rowsOf(ref, all)) {
        if (row.locale !== locale || !row.isCustom || row.module === owner) continue;
        const shipped = shippedValue(row.module, locale, ref.namespace, ref.key);
        ops.push(shipped === null ? { drop: { id: row.id } } : { restore: { id: row.id, value: shipped } });
    }
    return ops;
}

/**
 * The writes that put a string back to what ships in one language: every
 * edit the site hears for it restored. Null when an edit has nothing shipped
 * to go back to, since dropping it would take the string off the site while
 * reading to the operator as a restore.
 */
export function restoreOps(ref: LineRef, all: LineRow[], locale: string): EditOp[] | null {
    const ops: EditOp[] = [];
    for (const row of rowsOf(ref, all)) {
        if (row.locale !== locale || !row.isCustom) continue;
        const shipped = shippedValue(row.module, locale, ref.namespace, ref.key);
        if (shipped === null) return null;
        ops.push({ restore: { id: row.id, value: shipped } });
    }
    return ops;
}

/**
 * What an edit in one language is measured against: what the site says
 * without the edit, or what it says now once that origin is gone, or, for a
 * language nothing ships yet, the one everything is translated from.
 */
export function measureOf(line: Line, locale: string, sourceLocale: string): string {
    const said = line.locales[locale];
    const source = line.locales[sourceLocale];
    return said?.shipped ?? said?.value ?? shippedValue(line.owner, locale, line.namespace, line.key)
        ?? source?.shipped ?? source?.value ?? "";
}

/** The Prisma calls for `editOps`, to run in one transaction. */
export function editCalls(ref: LineRef, ops: EditOp[]) {
    return ops.map((op) => {
        if ("upsert" in op) {
            const { locale, module, value, basis } = op.upsert;
            return prisma.translation.upsert({
                where: { locale_namespace_key_module: { locale, namespace: ref.namespace, key: ref.key, module } },
                update: { value, isCustom: true, basis },
                create: { locale, namespace: ref.namespace, key: ref.key, module, value, isCustom: true, basis },
            });
        }
        if ("restore" in op) {
            return prisma.translation.update({ where: { id: op.restore.id }, data: { value: op.restore.value, isCustom: false } });
        }
        return prisma.translation.delete({ where: { id: op.drop.id } });
    });
}
