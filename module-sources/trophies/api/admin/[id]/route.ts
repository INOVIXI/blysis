import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { contentTranslationsInput, deleteContentTranslations, invalidate, isAdmin, logActivity, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { RULES_MODES, TRANSLATED_FIELDS, TROPHY_TEXT, trophyRuleSchema } from "../../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

async function requireAdmin() {
    const session = await auth();
    if (!session?.user?.id || !(await isAdmin(session.user.id, session.user.role))) {
        return null;
    }
    return session;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
    if (!(await requireAdmin())) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const trophy = await prisma.trophy.findUnique({
        where: { id },
        include: { _count: { select: { users: true } } },
    });
    if (!trophy) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ trophy });
}

const patchSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    icon: z.string().max(50).nullable().optional(),
    color: z.string().max(50).nullable().optional(),
    points: z.number().int().min(0).optional(),
    ruleType: z.string().max(50).nullable().optional(),
    ruleEvent: z.string().max(120).nullable().optional(),
    ruleThreshold: z.number().int().min(1).nullable().optional(),
    // A trophy can wait for more than one thing. The two columns above stay,
    // holding the first of them, so anything still reading those sees a rule
    // rather than nothing.
    rules: z.array(trophyRuleSchema).max(20).nullable().optional(),
    rulesMode: z.enum(RULES_MODES).nullable().optional(),
    isActive: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await requireAdmin();
    if (!session) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message || "Invalid input" },
            { status: 400 }
        );
    }

    const translations = contentTranslationsInput(body, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });

    const data = parsed.data;
    const update: Record<string, unknown> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.icon !== undefined) update.icon = data.icon;
    if (data.color !== undefined) update.color = data.color;
    if (data.points !== undefined) update.points = data.points;
    if (data.ruleType !== undefined) update.ruleType = data.ruleType;
    if (data.ruleEvent !== undefined) update.ruleEvent = data.ruleEvent;
    if (data.ruleThreshold !== undefined) update.ruleThreshold = data.ruleThreshold;
    if (data.rules !== undefined) update.rules = data.rules;
    if (data.rulesMode !== undefined) update.rulesMode = data.rulesMode;
    if (data.isActive !== undefined) update.isActive = data.isActive;

    // Keep legacy `awardOn` in sync whenever the rule changes.
    if (data.ruleEvent !== undefined || data.ruleThreshold !== undefined) {
        const existing = await prisma.trophy.findUnique({
            where: { id },
            select: { ruleEvent: true, ruleThreshold: true },
        });
        const nextEvent = data.ruleEvent !== undefined ? data.ruleEvent : existing?.ruleEvent;
        const nextThreshold =
            data.ruleThreshold !== undefined ? data.ruleThreshold : (existing?.ruleThreshold ?? 1);
        update.awardOn = nextEvent ? `${nextEvent}:${nextThreshold ?? 1}` : null;
    }

    const trophy = await prisma.$transaction(async (tx) => {
        const updated = await tx.trophy.update({ where: { id }, data: update });
        if (translations.value) await saveContentTranslations(tx, { ...TROPHY_TEXT, recordId: id }, translations.value);
        return updated;
    });

    await invalidate("trophies:public");

    logActivity({
        userId: session.user.id,
        action: "trophy.update",
        entity: "trophy",
        entityId: trophy.id,
        metadata: { changes: Object.keys(update) },
    }).catch(() => {});

    return NextResponse.json({ trophy });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const session = await requireAdmin();
    if (!session) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    // UserTrophy rows cascade via onDelete: Cascade; the translations are
    // not tied to the row by the database, so they go in the same transaction.
    await prisma.$transaction(async (tx) => {
        await tx.trophy.delete({ where: { id } });
        await deleteContentTranslations(tx, TROPHY_TEXT, [id]);
    });

    await invalidate("trophies:public");

    logActivity({
        userId: session.user.id,
        action: "trophy.delete",
        entity: "trophy",
        entityId: id,
    }).catch(() => {});

    return NextResponse.json({ ok: true });
}
