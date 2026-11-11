import { NextRequest, NextResponse } from "next/server";
import { contentTranslationsInput, deleteContentTranslations, isAdmin, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { SLIDE_TEXT, TRANSLATED_FIELDS, slideUpdateSchema } from "../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

async function requireAdmin(): Promise<NextResponse | null> {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return null;
}

// PATCH /api/v1/slider/[id] - Update a slide (admin)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const denied = await requireAdmin();
    if (denied) return denied;

    const { id } = await params;
    const existing = await prisma.sliderItem.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Slide not found" }, { status: 404 });

    const body = await readJsonBody(request, { fallback: {} });
    if (body instanceof NextResponse) return body;
    const parsed = slideUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const translations = contentTranslationsInput(body, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });
    const fields = parsed.data;

    const data: Record<string, unknown> = {};
    // Only fields the request actually carried, so a partial edit does not
    // blank the rest of the slide.
    if (fields.title !== undefined) data.title = fields.title || null;
    if (fields.subtitle !== undefined) data.subtitle = fields.subtitle || null;
    if (fields.image !== undefined) data.image = fields.image;
    if (fields.link !== undefined) data.link = fields.link || null;
    if (fields.order !== undefined) data.order = fields.order;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;

    const item = await prisma.$transaction(async (tx) => {
        const updated = await tx.sliderItem.update({ where: { id }, data });
        if (translations.value) await saveContentTranslations(tx, { ...SLIDE_TEXT, recordId: id }, translations.value);
        return updated;
    });
    return NextResponse.json({ item });
}

// DELETE /api/v1/slider/[id] - Delete a slide (admin)
export async function DELETE(_: NextRequest, { params }: RouteParams) {
    const denied = await requireAdmin();
    if (denied) return denied;

    const { id } = await params;
    const existing = await prisma.sliderItem.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Slide not found" }, { status: 404 });

    await prisma.$transaction(async (tx) => {
        await tx.sliderItem.delete({ where: { id } });
        await deleteContentTranslations(tx, SLIDE_TEXT, [id]);
    });
    return NextResponse.json({ ok: true });
}
