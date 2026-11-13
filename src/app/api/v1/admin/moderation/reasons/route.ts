import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { prisma } from "@/core/lib/db";
import { readJsonBody } from "@/core/lib/api-body";
import { logActivity } from "@/core/lib/activity-log";
import { resolveLocaleFromRequest } from "@/core/lib/i18n/resolve-locale";
import { contentTranslationsInput, readContentTranslations, saveContentTranslations } from "@/core/lib/content-translations";
import { listReasons, MODERATION_REASON_TEXT, REASON_LABEL_MAX } from "@/core/lib/moderation-reasons";

const createSchema = z.object({
    label: z.string().trim().min(1, "A reason needs a name").max(REASON_LABEL_MAX),
    position: z.number().int().min(0).max(10_000).optional(),
    enabled: z.boolean().optional(),
});

/**
 * GET /api/v1/admin/moderation/reasons
 * Every reason, disabled ones included, each with the admin's own wording
 * (`label`, null for a shipped reason nobody renamed), its translations for
 * the editor, and `displayLabel`: what a moderator of the caller's language
 * reads.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const locale = await resolveLocaleFromRequest();
    const views = await listReasons(locale, { includeDisabled: true });
    const ids = views.map((view) => view.id);
    const [rows, translations] = await Promise.all([
        prisma.moderationReason.findMany({ where: { id: { in: ids } }, select: { id: true, label: true } }),
        readContentTranslations(prisma, MODERATION_REASON_TEXT, ids),
    ]);
    const own = new Map(rows.map((row) => [row.id, row.label]));

    return NextResponse.json({
        reasons: views.map((view) => ({
            id: view.id,
            key: view.key,
            label: own.get(view.id) ?? null,
            displayLabel: view.label,
            enabled: view.enabled,
            position: view.position,
            translations: translations.get(view.id) ?? {},
        })),
    });
}

/** POST /api/v1/admin/moderation/reasons: a reason of the site's own. */
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
        const unnamed = parsed.error.issues.some((issue) => issue.path[0] === "label");
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message ?? "Invalid", ...(unnamed ? { code: "reason_needs_name" } : {}) },
            { status: 400 },
        );
    }
    const translations = contentTranslationsInput(body, { label: REASON_LABEL_MAX });
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });

    const reason = await prisma.$transaction(async (tx) => {
        const created = await tx.moderationReason.create({
            data: {
                label: parsed.data.label,
                position: parsed.data.position ?? 0,
                enabled: parsed.data.enabled ?? true,
            },
        });
        if (translations.value) {
            await saveContentTranslations(tx, { ...MODERATION_REASON_TEXT, recordId: created.id }, translations.value);
        }
        return created;
    });

    logActivity({
        userId: session.user.id,
        action: "moderation.reason.create",
        entity: "moderationReason",
        entityId: reason.id,
    }).catch(() => {});

    return NextResponse.json({ reason }, { status: 201 });
}
