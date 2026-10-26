import { NextResponse } from "next/server";
import { apiError } from "@/core/lib/api-utils";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { heardBy } from "@/core/lib/i18n/translation-lines";
import { activeThemeId } from "@/core/lib/i18n/translation-service";
import { WORDS_FILE_FORMAT } from "@/core/lib/i18n/words-file";
import { isAdmin } from "@/core/lib/permissions";

/**
 * The site's own words, as a file to take to another install.
 *
 * Every string the site edited and still hears, in the language it edited
 * it, and nothing that ships: those arrive with the software. Read back in by
 * `/api/v1/admin/translations/import`.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return apiError("Unauthorized", 401);
    if (!(await isAdmin(session.user.id, session.user.role))) return apiError("Forbidden", 403);

    const themeId = await activeThemeId();
    const rows = await prisma.translation.findMany({
        where: { AND: [heardBy(themeId), { isCustom: true }] },
        select: { namespace: true, key: true, locale: true, value: true },
        orderBy: [{ namespace: "asc" }, { key: "asc" }, { locale: "asc" }],
    });
    const day = new Date().toISOString().slice(0, 10);
    return NextResponse.json(
        {
            format: WORDS_FILE_FORMAT,
            version: 1,
            exportedAt: new Date().toISOString(),
            strings: rows.map(({ namespace, key, locale, value }) => ({ namespace, key, locale, value })),
        },
        { headers: { "Content-Disposition": `attachment; filename="site-words-${day}.json"` } },
    );
}
