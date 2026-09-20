import { NextRequest, NextResponse } from "next/server";
import { slugify } from "@/core/sdk";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { helpCategorySchema } from "../../../lib/validations";

/**
 * GET /api/v1/help/categories - the published list, and the operator's list.
 *
 * Same split as the articles endpoint, for the same reason: the panel read
 * the visitor's answer, so a category somebody deactivated left the only
 * screen that could bring it back or take it away.
 */
export async function GET(request: NextRequest) {
    if (new URL(request.url).searchParams.get("scope") === "admin") {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

        const categories = await prisma.helpCategory.findMany({
            orderBy: { order: "asc" },
            include: { _count: { select: { articles: true } } },
        });
        return NextResponse.json({ categories });
    }

    const categories = await prisma.helpCategory.findMany({
        where: { isActive: true },
        orderBy: { order: "asc" },
        include: {
            _count: { select: { articles: true } },
        },
    });

    return NextResponse.json(categories);
}

// POST /api/v1/help/categories - Create category (admin)
export async function POST(request: NextRequest) {
    const session = await auth();

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await isAdmin(session.user.id);
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = helpCategorySchema.safeParse(body);

    if (!validation.success) {
        return NextResponse.json(
            { error: "Validation failed", details: validation.error.flatten() },
            { status: 400 }
        );
    }

    const { name, slug, description, icon, image, order, isActive } = validation.data;
    const categorySlug = slug || slugify(name);

    const category = await prisma.helpCategory.create({
        data: {
            name,
            slug: categorySlug,
            description,
            icon,
            image,
            order: order || 0,
            isActive: isActive ?? true,
        },
    });

    return NextResponse.json(category, { status: 201 });
}
