import { NextRequest, NextResponse } from "next/server";
import { generateSlug } from "@/core/sdk";
import { contentTranslationsInput, deleteContentTranslations, hasPermission, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { categorySchema } from "../../../lib/validations";
import { CATEGORY_FIELDS, CATEGORY_TEXT, categoriesIn, localeOf } from "../../../lib/store-text";

type RouteParams = { params: Promise<{ id: string }> };

// GET /api/v1/store/categories/[id]
export async function GET(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;

    const found = await prisma.category.findFirst({
        where: { OR: [{ id }, { slug: id }] },
        include: {
            children: true,
            _count: { select: { products: true } },
        },
    });

    if (!found) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const [category] = await categoriesIn([found], localeOf(request));
    return NextResponse.json({ category });
}

// PATCH /api/v1/store/categories/[id]
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await hasPermission(session.user.id, "store.manage");
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = categorySchema.partial().safeParse(body);

    if (!validation.success) {
        return NextResponse.json(
            { error: validation.error.issues[0].message },
            { status: 400 }
        );
    }

    const translations = contentTranslationsInput((body as { translations?: unknown }).translations, CATEGORY_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });

    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = { ...validation.data };

    // A shelf cannot be unlocked by something standing on it. Gating a
    // category behind a product inside it makes it visible only to somebody
    // who already bought from a shelf they cannot see, and nothing on the
    // page would say why it never appears.
    const gates = validation.data.visibleAfterProductIds;
    if (gates && gates.length > 0) {
        const inside = await prisma.product.count({
            where: { id: { in: gates }, categoryId: id },
        });
        if (inside > 0) {
            return NextResponse.json(
                { error: "A category cannot be unlocked by a product inside it" },
                { status: 400 },
            );
        }
    }

    if (data.name && !data.slug) {
        const newSlug = generateSlug(data.name as string);
        const slugExists = await prisma.category.findFirst({
            where: { slug: newSlug, id: { not: id } },
        });
        if (!slugExists) data.slug = newSlug;
    }

    const category = await prisma.$transaction(async (tx) => {
        const updated = await tx.category.update({
            where: { id },
            data,
            include: { children: true },
        });
        if (translations.value) await saveContentTranslations(tx, { ...CATEGORY_TEXT, recordId: id }, translations.value);
        return updated;
    });

    return NextResponse.json({ category });
}

// DELETE /api/v1/store/categories/[id]
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await hasPermission(session.user.id, "store.manage");
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    // Move products and children to no category
    await prisma.product.updateMany({
        where: { categoryId: id },
        data: { categoryId: null },
    });
    await prisma.category.updateMany({
        where: { parentId: id },
        data: { parentId: null },
    });

    await prisma.$transaction(async (tx) => {
        await tx.category.delete({ where: { id } });
        await deleteContentTranslations(tx, CATEGORY_TEXT, [id]);
    });

    return NextResponse.json({ message: "Category deleted" });
}
