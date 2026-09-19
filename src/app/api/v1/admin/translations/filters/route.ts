import { apiError, apiSuccess } from "@/core/lib/api-utils";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { isAdmin } from "@/core/lib/permissions";
import { locales } from "@/core/lib/i18n/config";

/**
 * What the translation editor can be narrowed by.
 *
 * Read from the table rather than from a list in code, because the answer
 * changes with every module installed and core is not allowed to know their
 * names. Grouped reads over indexed columns, not the catalogue itself.
 *
 * The third answer is how far behind each language is, which the screen had
 * no way to ask. It was built for two languages and showed both on every row,
 * so "which language needs work" was a thing you found out by scrolling. A
 * string is counted as missing when no row carries it for that locale, which
 * is the same thing the merge falls back to at runtime.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return apiError("Unauthorized", 401);
    if (!(await isAdmin(session.user.id, session.user.role))) return apiError("Forbidden", 403);

    const [modules, namespaces, byLocale] = await Promise.all([
        prisma.translation.groupBy({ by: ["module"], orderBy: { module: "asc" } }),
        prisma.translation.groupBy({ by: ["namespace"], orderBy: { namespace: "asc" } }),
        prisma.translation.groupBy({ by: ["locale"], _count: { _all: true } }),
    ]);

    /*
     * How many strings each language is short of the fullest one.
     *
     * The catalogue has no single authority on how many strings exist - a
     * module ships what it ships, per locale - so the count to measure
     * against is the locale that has the most. A language with every string
     * is zero behind, which is the number an operator is looking for.
     */
    const held = new Map(byLocale.map((row) => [row.locale, row._count._all]));
    const fullest = Math.max(0, ...locales.map((locale) => held.get(locale) ?? 0));

    return apiSuccess({
        modules: modules.map((row) => row.module),
        namespaces: namespaces.map((row) => row.namespace),
        locales: locales.map((locale) => ({
            locale,
            held: held.get(locale) ?? 0,
            missing: Math.max(0, fullest - (held.get(locale) ?? 0)),
        })),
    });
}
