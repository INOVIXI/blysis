import { apiError, apiSuccess } from "@/core/lib/api-utils";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { isAdmin } from "@/core/lib/permissions";
import { locales } from "@/core/lib/i18n/config";
import { sourceName } from "@/core/lib/i18n/source-name";
import { heardBy, heardSql } from "@/core/lib/i18n/translation-lines";
import { activeThemeId } from "@/core/lib/i18n/translation-service";

/**
 * What the translation editor can be narrowed by.
 *
 * Read from the table rather than from a list in code, because the answer
 * changes with every module installed and core is not allowed to know their
 * names. Grouped reads over indexed columns, not the catalogue itself, and
 * only of rows the site hears: another theme's wording is not a source.
 *
 * The third answer is how far behind each language is, which the screen had
 * no way to ask. A string is missing in a language when no source has a row
 * for it there, which is the same thing the merge falls back to at runtime.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return apiError("Unauthorized", 401);
    if (!(await isAdmin(session.user.id, session.user.role))) return apiError("Forbidden", 403);

    const themeId = await activeThemeId();
    const heard = heardBy(themeId);
    const [sources, namespaces, total, byLocale] = await Promise.all([
        prisma.translation.groupBy({ by: ["module"], where: heard, orderBy: { module: "asc" } }),
        prisma.translation.groupBy({ by: ["namespace"], where: heard, orderBy: { namespace: "asc" } }),
        // A string is counted once however many sources have a row for it,
        // so the measure is distinct strings, not rows.
        prisma.$queryRaw<{ strings: number }[]>`
            SELECT COUNT(DISTINCT ("namespace", "key"))::int AS strings FROM "Translation" WHERE ${heardSql(themeId)}
        `,
        prisma.$queryRaw<{ locale: string; strings: number }[]>`
            SELECT "locale", COUNT(DISTINCT ("namespace", "key"))::int AS strings
            FROM "Translation" WHERE ${heardSql(themeId)} GROUP BY "locale"
        `,
    ]);

    const strings = total[0]?.strings ?? 0;
    const held = new Map(byLocale.map((row) => [row.locale, row.strings]));

    return apiSuccess({
        sources: sources.map((row) => ({ id: row.module, name: sourceName(row.module) })),
        namespaces: namespaces.map((row) => row.namespace),
        locales: locales.map((locale) => ({
            locale,
            held: held.get(locale) ?? 0,
            missing: Math.max(0, strings - (held.get(locale) ?? 0)),
        })),
    });
}
