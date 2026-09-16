import { NextRequest, NextResponse } from "next/server";
import { generateSlug } from "@/core/sdk";
import { hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { blogCategorySchema } from "../../../lib/validations";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/v1/blog/categories/[id]
export async function GET(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;

    const category = await prisma.blogCategory.findFirst({
        where: { OR: [{ id }, { slug: id }] },
        include: { _count: { select: { articles: true } } },
    });

    if (!category) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    return NextResponse.json(category);
}

// PATCH /api/v1/blog/categories/[id]
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await hasPermission(session.user.id, "blog.manage");
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = blogCategorySchema.partial().safeParse(body);

    if (!validation.success) {
        return NextResponse.json(
            { error: validation.error.issues[0].message },
            { status: 400 }
        );
    }

    const existing = await prisma.blogCategory.findUnique({ where: { id } });
    if (!existing) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = { ...validation.data };

    // Regenerate slug if name changed
    if (data.name && !data.slug) {
        const newSlug = generateSlug(data.name as string);
        const slugExists = await prisma.blogCategory.findFirst({
            where: { slug: newSlug, id: { not: id } },
        });
        if (!slugExists) data.slug = newSlug;
    }

    const category = await prisma.blogCategory.update({
        where: { id },
        data,
    });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("blog.category.updated", category);

    return NextResponse.json(category);
}

// DELETE /api/v1/blog/categories/[id]
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await hasPermission(session.user.id, "blog.manage");
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await prisma.blogCategory.findUnique({ where: { id } });
    if (!existing) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    // Unlink articles from this category before deleting
    await prisma.blogArticle.updateMany({
        where: { categoryId: id },
        data: { categoryId: null },
    });

    await prisma.blogCategory.delete({ where: { id } });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("blog.category.deleted", existing);

    return NextResponse.json({ message: "Category deleted" });
}
