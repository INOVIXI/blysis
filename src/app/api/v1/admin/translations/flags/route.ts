import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/core/lib/activity-log";
import { readJsonBody } from "@/core/lib/api-body";
import { apiError, apiSuccess } from "@/core/lib/api-utils";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { locales } from "@/core/lib/i18n/config";
import { FLAG_REVIEW, FLAG_TRANSLATE } from "@/core/lib/i18n/flag-reasons";
import { shippedValue } from "@/core/lib/i18n/shipped-value";
import { lineFlags, lineOf, lineRows } from "@/core/lib/i18n/translation-lines";
import { activeThemeId } from "@/core/lib/i18n/translation-service";
import { isAdmin } from "@/core/lib/permissions";
import { prismaErrorOrThrow } from "@/core/lib/prisma-errors";

/**
 * The operator has looked at a string and it stands.
 *
 * A review answered this way keeps the site's words against the new
 * original, which becomes what the edit was written against, so the next
 * update is measured from it. A translation marked still right is only
 * unmarked. Taking the new original instead is a restore, and a new
 * translation is a save; both clear the mark on their own.
 */

const markSchema = z.object({
    namespace: z.string().min(1).max(120),
    key: z.string().min(1).max(300),
    locale: z.enum(locales),
    reason: z.enum([FLAG_REVIEW, FLAG_TRANSLATE]),
});

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return apiError("Unauthorized", 401);
    if (!(await isAdmin(session.user.id, session.user.role))) return apiError("Forbidden", 403);

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = markSchema.safeParse(body);
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message || "Invalid input", 400);
    const { namespace, key, locale, reason } = parsed.data;
    const ref = { namespace, key };

    const flag = await prisma.translationFlag.findUnique({
        where: { locale_namespace_key_reason: { locale, namespace, key, reason } },
        select: { id: true },
    });
    if (!flag) return apiError("Nothing is asked of this string here", 404, { code: "translation_flag_not_found" });

    const themeId = await activeThemeId();
    const rows = reason === FLAG_REVIEW ? await lineRows([ref], themeId, [locale]) : [];
    // What the site says does not change, so the cached catalogue stands.
    try {
        const rebased = rows.flatMap((row) => {
            const basis = row.isCustom ? shippedValue(row.module, locale, namespace, key) : null;
            return basis === null ? [] : [prisma.translation.update({ where: { id: row.id }, data: { basis } })];
        });
        await prisma.$transaction([...rebased, prisma.translationFlag.delete({ where: { id: flag.id } })]);
    } catch (error) {
        // Read a moment ago, so what gets here is a second admin answering
        // the same question in between.
        return prismaErrorOrThrow(error);
    }

    logActivity({
        userId: session.user.id,
        action: "translation.looked_at",
        entity: "translation",
        entityId: `${namespace}:${key}`,
        metadata: { namespace, key, locale, reason },
    }).catch(() => {});

    const [after, flags] = await Promise.all([lineRows([ref], themeId), lineFlags([ref], locales)]);
    return apiSuccess({ item: lineOf(ref, after, locales, flags) });
}
