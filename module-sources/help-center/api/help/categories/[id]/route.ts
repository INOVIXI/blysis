import { NextRequest, NextResponse } from "next/server";
import { isAdmin, logActivity, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { helpCategoryUpdateSchema } from "../../../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

// PATCH /api/v1/help/categories/[id] - Update category (admin)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.helpCategory.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Category not found" }, { status: 404 });

    const body = await readJsonBody(request, { fallback: {} });
    if (body instanceof NextResponse) return body;
    const parsed = helpCategoryUpdateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const fields = parsed.data;

    const data: Record<string, unknown> = {};
    if (fields.name !== undefined) data.name = fields.name;
    if (fields.slug !== undefined) data.slug = fields.slug;
    if (fields.description !== undefined) data.description = fields.description;
    if (fields.icon !== undefined) data.icon = fields.icon;
    if (fields.order !== undefined) data.order = fields.order;
    if (fields.isActive !== undefined) data.isActive = fields.isActive;

    const updated = await prisma.helpCategory.update({ where: { id }, data });
    await logActivity({
        userId: session.user.id,
        action: "help_category.update",
        entity: "HelpCategory",
        entityId: updated.id,
        metadata: { name: updated.name, fields: Object.keys(data) },
    });
    return NextResponse.json({ category: updated });
}

// DELETE /api/v1/help/categories/[id] - Delete category (admin).
// Refuses if the category still has articles.
export async function DELETE(_: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const existing = await prisma.helpCategory.findUnique({
        where: { id },
        include: { _count: { select: { articles: true } } },
    });
    if (!existing) return NextResponse.json({ error: "Category not found" }, { status: 404 });
    if (existing._count.articles > 0) {
        return NextResponse.json(
            { error: `Cannot delete: category has ${existing._count.articles} article(s). Delete them first or set inactive.`, code: "category_has_articles" },
            { status: 409 },
        );
    }

    await prisma.helpCategory.delete({ where: { id } });
    await logActivity({
        userId: session.user.id,
        action: "help_category.delete",
        entity: "HelpCategory",
        entityId: id,
        metadata: { name: existing.name },
    });
    return NextResponse.json({ ok: true });
}
