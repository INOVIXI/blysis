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
}

interface Said {
    value: string | null;
    /** The source whose row the site reads. */
    from: string | null;
    isCustom: boolean;
    /** What the site would say without its own edit. */
    shipped: string | null;
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
        select: { id: true, locale: true, module: true, namespace: true, key: true, value: true, isCustom: true },
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

export function lineOf(ref: LineRef, all: LineRow[], locales: readonly string[]): Line {
    const rows = rowsOf(ref, all);
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
            }];
        })),
    };
}

export type EditOp =
    | { upsert: { locale: string; module: string; value: string } }
    | { restore: { id: string; value: string } }
    | { drop: { id: string } };

/**
 * The writes that make a string say `value` in one language: the owner's row
 * edited, and any older edit on another source undone, since an edit there
 * would be heard over this one. One that has nothing shipped to go back to is
 * dropped; it was only ever the site's words.
 */
export function editOps(ref: LineRef, owner: string, all: LineRow[], locale: string, value: string): EditOp[] {
    const ops: EditOp[] = [{ upsert: { locale, module: owner, value } }];
    for (const row of rowsOf(ref, all)) {
        if (row.locale !== locale || !row.isCustom || row.module === owner) continue;
        const shipped = shippedValue(row.module, locale, ref.namespace, ref.key);
        ops.push(shipped === null ? { drop: { id: row.id } } : { restore: { id: row.id, value: shipped } });
    }
    return ops;
}

/** The Prisma calls for `editOps`, to run in one transaction. */
export function editCalls(ref: LineRef, ops: EditOp[]) {
    return ops.map((op) => {
        if ("upsert" in op) {
            const { locale, module, value } = op.upsert;
            return prisma.translation.upsert({
                where: { locale_namespace_key_module: { locale, namespace: ref.namespace, key: ref.key, module } },
                update: { value, isCustom: true },
                create: { locale, namespace: ref.namespace, key: ref.key, module, value, isCustom: true },
            });
        }
        if ("restore" in op) {
            return prisma.translation.update({ where: { id: op.restore.id }, data: { value: op.restore.value, isCustom: false } });
        }
        return prisma.translation.delete({ where: { id: op.drop.id } });
    });
}
