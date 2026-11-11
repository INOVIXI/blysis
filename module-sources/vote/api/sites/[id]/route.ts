import { NextRequest, NextResponse } from "next/server";
import { contentTranslationsInput, deleteContentTranslations, isAdmin, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { TRANSLATED_FIELDS, VOTE_SITE_TEXT, voteSiteUpdateSchema } from "../../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

// PATCH /api/v1/vote/sites/[id] - Update a vote site (admin)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.voteSite.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Vote site not found" }, { status: 404 });

    const body = await readJsonBody(request, { fallback: {} });
    if (body instanceof NextResponse) return body;
    const parsed = voteSiteUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const translations = contentTranslationsInput(body, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });
    const fields = parsed.data;

    const data: Record<string, unknown> = {};
    if (fields.name !== undefined) data.name = fields.name;
    if (fields.url !== undefined) data.url = fields.url;
    if (fields.icon !== undefined) data.icon = fields.icon;
    if (fields.order !== undefined) data.order = fields.order;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;

    const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.voteSite.update({ where: { id }, data });
        if (translations.value) await saveContentTranslations(tx, { ...VOTE_SITE_TEXT, recordId: id }, translations.value);
        return row;
    });
    return NextResponse.json({ site: updated });
}

// DELETE /api/v1/vote/sites/[id] - Delete a vote site (admin)
export async function DELETE(_: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.voteSite.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Vote site not found" }, { status: 404 });

    await prisma.$transaction(async (tx) => {
        await tx.voteSite.delete({ where: { id } });
        await deleteContentTranslations(tx, VOTE_SITE_TEXT, [id]);
    });
    return NextResponse.json({ ok: true });
}
