import { NextRequest, NextResponse } from "next/server";
import { contentTranslationsInput, deleteContentTranslations, isAdmin, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { forumCategoryUpdateSchema } from "../../../lib/validations";
import { CATEGORY_TEXT, TRANSLATED_FIELDS } from "../../../lib/category-text";

type RouteParams = { params: Promise<{ id: string }> };

// PATCH /api/v1/forum/categories/[id] - Update a category (admin)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.forumCategory.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Category not found" }, { status: 404 });

    const body = await readJsonBody(request, { fallback: {} });
    if (body instanceof NextResponse) return body;
    const parsed = forumCategoryUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const translations = contentTranslationsInput(body, TRANSLATED_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });
    const fields = parsed.data;

    const data: Record<string, unknown> = {};
    if (fields.name !== undefined) data.name = fields.name;
    if (fields.slug !== undefined) data.slug = fields.slug;
    if (fields.description !== undefined) data.description = fields.description;
    if (fields.color !== undefined) data.color = fields.color;
    if (fields.icon !== undefined) data.icon = fields.icon;
    if (fields.order !== undefined) data.order = fields.order;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;

    const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.forumCategory.update({ where: { id }, data });
        if (translations.value) await saveContentTranslations(tx, { ...CATEGORY_TEXT, recordId: id }, translations.value);
        return row;
    });
    return NextResponse.json({ category: updated });
}

// DELETE /api/v1/forum/categories/[id] - Delete a category (admin).
// Refuses if the category still has topics - admin must move/delete them
// first or set isActive=false to hide instead.
export async function DELETE(_: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.forumCategory.findUnique({
        where: { id },
        include: { _count: { select: { topics: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Category not found" }, { status: 404 });
    if (existing._count.topics > 0) {
        return NextResponse.json(
            { error: `Cannot delete: category has ${existing._count.topics} topic(s). Move or delete them first, or set the category inactive instead.`, code: "category_has_topics" },
            { status: 409 },
        );
    }

    await prisma.$transaction(async (tx) => {
        await tx.forumCategory.delete({ where: { id } });
        await deleteContentTranslations(tx, CATEGORY_TEXT, [id]);
    });
    return NextResponse.json({ ok: true });
}
