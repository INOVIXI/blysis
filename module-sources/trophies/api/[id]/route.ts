import { NextRequest, NextResponse } from "next/server";
import { contentTranslationsInput, deleteContentTranslations, isAdmin, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { TRANSLATED_FIELDS, TROPHY_TEXT, trophyUpdateSchema } from "../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = trophyUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const translations = contentTranslationsInput(body, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });
    const fields = parsed.data;

    const data: Record<string, unknown> = {};
    if (fields.name !== undefined) data.name = fields.name;
    if (fields.description !== undefined) data.description = fields.description;
    if (fields.icon !== undefined) data.icon = fields.icon;
    if (fields.color !== undefined) data.color = fields.color;
    if (fields.points !== undefined) data.points = fields.points;
    if (fields.awardOn !== undefined) data.awardOn = fields.awardOn;
    const trophy = await prisma.$transaction(async (tx) => {
        const updated = await tx.trophy.update({ where: { id }, data });
        if (translations.value) await saveContentTranslations(tx, { ...TROPHY_TEXT, recordId: id }, translations.value);
        return updated;
    });
    return NextResponse.json({ trophy });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isAdmin(session.user.id, session.user.role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    await prisma.$transaction(async (tx) => {
        await tx.trophy.delete({ where: { id } });
        await deleteContentTranslations(tx, TROPHY_TEXT, [id]);
    });
    return NextResponse.json({ ok: true });
}
