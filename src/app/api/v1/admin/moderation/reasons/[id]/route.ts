import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { prisma } from "@/core/lib/db";
import { readJsonBody } from "@/core/lib/api-body";
import { logActivity } from "@/core/lib/activity-log";
import { contentTranslationsInput, deleteContentTranslations, saveContentTranslations } from "@/core/lib/content-translations";
import { MODERATION_REASON_TEXT, REASON_LABEL_MAX } from "@/core/lib/moderation-reasons";

type RouteParams = { params: Promise<{ id: string }> };

const updateSchema = z.object({
    // Empty puts a shipped reason back on the catalogue's wording.
    label: z.string().trim().max(REASON_LABEL_MAX).optional(),
    position: z.number().int().min(0).max(10_000).optional(),
    enabled: z.boolean().optional(),
});

/** PATCH /api/v1/admin/moderation/reasons/[id] */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
    }
    const translations = contentTranslationsInput(body, { label: REASON_LABEL_MAX });
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });

    const existing = await prisma.moderationReason.findUnique({ where: { id }, select: { id: true, key: true } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const data: { label?: string | null; position?: number; enabled?: boolean } = {};
    if (parsed.data.label !== undefined) {
        if (parsed.data.label === "" && !existing.key) {
            return NextResponse.json({ error: "A reason needs a name", code: "reason_needs_name" }, { status: 400 });
        }
        data.label = parsed.data.label === "" ? null : parsed.data.label;
    }
    if (parsed.data.position !== undefined) data.position = parsed.data.position;
    if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;

    const reason = await prisma.$transaction(async (tx) => {
        const updated = await tx.moderationReason.update({ where: { id }, data });
        if (translations.value) {
            await saveContentTranslations(tx, { ...MODERATION_REASON_TEXT, recordId: id }, translations.value);
        }
        return updated;
    });

    logActivity({
        userId: session.user.id,
        action: "moderation.reason.update",
        entity: "moderationReason",
        entityId: id,
    }).catch(() => {});

    return NextResponse.json({ reason });
}

/**
 * DELETE /api/v1/admin/moderation/reasons/[id]
 *
 * Only a reason of the site's own that no decision gave. A decision keeps
 * its reason so the Rejected view and the author's page can say it; a
 * shipped reason would be put back the next time the list is read. Both are
 * disabled instead, and the refusal says so.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const existing = await prisma.moderationReason.findUnique({ where: { id }, select: { id: true, key: true } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.key) {
        return NextResponse.json({ error: "A shipped reason can be disabled, not deleted", code: "reason_shipped" }, { status: 409 });
    }
    if ((await prisma.moderationDecision.count({ where: { reasonId: id } })) > 0) {
        return NextResponse.json({ error: "A decision gave this reason; disable it instead", code: "reason_in_use" }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
        await tx.moderationReason.delete({ where: { id } });
        await deleteContentTranslations(tx, MODERATION_REASON_TEXT, [id]);
    });

    logActivity({
        userId: session.user.id,
        action: "moderation.reason.delete",
        entity: "moderationReason",
        entityId: id,
    }).catch(() => {});

    return NextResponse.json({ ok: true });
}
