import { NextRequest, NextResponse } from "next/server";
import { generateSlug } from "@/core/sdk";
import { hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { blogCategorySchema } from "../../lib/validations";

// GET /api/v1/blog/categories - List all categories (public)
export async function GET() {
    const categories = await prisma.blogCategory.findMany({
        orderBy: { name: "asc" },
        include: {
            _count: {
                select: { articles: true },
            },
        },
    });

    return NextResponse.json(categories);
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

    const { name, slug: requestedSlug, description } = validation.data;
    const slug = requestedSlug || generateSlug(name);

    // Check if slug already exists
    const existingCategory = await prisma.blogCategory.findUnique({ where: { slug } });
    if (existingCategory) {
        return NextResponse.json({ error: "Slug already exists" }, { status: 400 });
    }

    const category = await prisma.blogCategory.create({
        data: { name, slug, description },
    });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("blog.category.created", category);

    return NextResponse.json(category, { status: 201 });
}
