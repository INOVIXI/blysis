import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logActivity } from "@/core/lib/activity-log";
import { readJsonBody } from "@/core/lib/api-body";
import { apiError, apiSuccess } from "@/core/lib/api-utils";
import { auth } from "@/core/lib/auth";
import { prisma } from "@/core/lib/db";
import { defaultLocale, locales } from "@/core/lib/i18n/config";
import { flagCalls } from "@/core/lib/i18n/translation-flags";
import { HISTORY_RESOURCE, historyCall, historyId, parseSnapshot, undoOps } from "@/core/lib/i18n/translation-history";
import { editCalls, lineFlags, lineOf, lineRows } from "@/core/lib/i18n/translation-lines";
import { activeThemeId, invalidateTranslationCache } from "@/core/lib/i18n/translation-service";
import { isAdmin } from "@/core/lib/permissions";
import { placeholderNames } from "@/core/lib/placeholders";
import { prismaErrorOrThrow } from "@/core/lib/prisma-errors";

/**
 * A string's earlier versions, and putting one back.
 *
 * Every change the editor makes leaves a version saying what each language
 * it touched said before (`translation-history`). Putting one back is checked
 * as a hand edit is and recorded as a version of its own, so an undo can be
 * undone.
 */

/** As far back as the editor shows; older versions are pruned with every revision. */
const SHOWN = 20;

async function requireAdmin() {
    const session = await auth();
    if (!session?.user?.id) return { error: apiError("Unauthorized", 401) };
    if (!(await isAdmin(session.user.id, session.user.role))) return { error: apiError("Forbidden", 403) };
    return { session };
}

const lineSchema = z.object({
    namespace: z.string().min(1).max(120),
    key: z.string().min(1).max(300),
});

export async function GET(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const parsed = lineSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message || "Invalid input", 400);

    const versions = await prisma.revision.findMany({
        where: { resource: HISTORY_RESOURCE, resourceId: historyId(parsed.data) },
        orderBy: { createdAt: "desc" },
        take: SHOWN,
        select: { id: true, createdAt: true, data: true, author: { select: { username: true } } },
    });
    const items = versions.flatMap((version) => {
        const snapshot = parseSnapshot(version.data);
        return snapshot ? [{
            id: version.id,
            createdAt: version.createdAt,
            author: version.author?.username ?? null,
            cause: snapshot.cause,
            locales: snapshot.locales,
        }] : [];
    });
    return apiSuccess({ items });
}

const undoSchema = z.object({ id: z.string().min(1).max(64) });

export async function POST(request: NextRequest) {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = undoSchema.safeParse(body);
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message || "Invalid input", 400);

    const version = await prisma.revision.findFirst({
        where: { id: parsed.data.id, resource: HISTORY_RESOURCE },
        select: { resourceId: true, data: true },
    });
    const snapshot = version ? parseSnapshot(version.data) : null;
    if (!version || !snapshot) return apiError("That version is no longer kept", 404, { code: "translation_history_not_found" });

    // The name is read back out of the version rather than trusted from the
    // request, so a version only ever puts back the string it was taken of.
    const split = version.resourceId.indexOf(":");
    const ref = { namespace: version.resourceId.slice(0, split), key: version.resourceId.slice(split + 1) };
    const themeId = await activeThemeId();
    const [rows, flags, sitePlaceholders] = await Promise.all([lineRows([ref], themeId), lineFlags([ref], locales), placeholderNames()]);
    const line = lineOf(ref, rows, locales, flags);

    const plan = undoOps(ref, line, rows, snapshot, defaultLocale, sitePlaceholders);
    if ("refusal" in plan) {
        return apiError("The version was not put back", 400, {
            code: plan.refusal.code,
            details: { locale: plan.refusal.locale, names: plan.refusal.names },
        });
    }
    const touched = Object.keys(snapshot.locales).filter((locale) => locale in line.locales);
    try {
        await prisma.$transaction([
            historyCall(ref, line, touched, "undo", guard.session?.user?.id),
            ...editCalls(ref, plan.ops),
            ...flagCalls(ref, line, touched, plan.changes),
        ]);
    } catch (error) {
        // The rows were read a moment ago, so what gets here is a second
        // admin having changed the string in between.
        return prismaErrorOrThrow(error);
    }
    await invalidateTranslationCache();

    logActivity({
        userId: guard.session?.user?.id,
        action: "translation.undo",
        entity: "translation",
        entityId: historyId(ref),
        metadata: { namespace: ref.namespace, key: ref.key, locales: touched },
    }).catch(() => {});

    const [after, afterFlags] = await Promise.all([lineRows([ref], themeId), lineFlags([ref], locales)]);
    return apiSuccess({ item: lineOf(ref, after, locales, afterFlags) });
}
