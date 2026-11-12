import { NextRequest, NextResponse } from "next/server";
import { generateSlug } from "@/core/sdk";
import { attachContentTranslations, contentTranslationsInput, hasPermission, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { blogCategorySchema } from "../../lib/validations";
import { CATEGORY_FIELDS, CATEGORY_TEXT, categoriesIn, localeOf } from "../../lib/blog-text";

/**
 * GET /api/v1/blog/categories - List all categories (public), in `?locale=`
 * and in the original where the admin wrote no translation.
 *
 * `scope=admin` is the editor's answer, with every language of each
 * category, refused to anybody who may not manage the blog.
 */
export async function GET(request: NextRequest) {
    const admin = new URL(request.url).searchParams.get("scope") === "admin";
    if (admin) {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!(await hasPermission(session.user.id, "blog.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const categories = await prisma.blogCategory.findMany({
        orderBy: { name: "asc" },
        include: {
            _count: {
                select: { articles: true },
            },
        },
    });

    if (admin) return NextResponse.json(await attachContentTranslations(prisma, CATEGORY_TEXT, categories));
    return NextResponse.json(await categoriesIn(categories, localeOf(request)));
}

// POST /api/v1/blog/categories - Create new category (admin only)
export async function POST(request: NextRequest) {
    const session = await auth();

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await hasPermission(session.user.id, "blog.manage");
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = blogCategorySchema.safeParse(body);

    if (!validation.success) {
        return NextResponse.json(
            { error: "Validation failed", details: validation.error.flatten() },
            { status: 400 }
        );
    }

    const translations = contentTranslationsInput(body, CATEGORY_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });

    const { name, slug: requestedSlug, description } = validation.data;
    const slug = requestedSlug || generateSlug(name);

    // Check if slug already exists
    const existingCategory = await prisma.blogCategory.findUnique({ where: { slug } });
    if (existingCategory) {
        return NextResponse.json({ error: "Slug already exists" }, { status: 400 });
    }

    const category = await prisma.$transaction(async (tx) => {
        const created = await tx.blogCategory.create({ data: { name, slug, description } });
        if (translations.value) await saveContentTranslations(tx, { ...CATEGORY_TEXT, recordId: created.id }, translations.value);
        return created;
    });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("blog.category.created", category);

    return NextResponse.json(category, { status: 201 });
}
