import { NextRequest, NextResponse } from "next/server";
import { slugify } from "@/core/sdk";
import { isAdmin, moduleSettings, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { helpArticleSchema } from "../../../lib/validations";

// GET /api/v1/help/articles - List articles
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get("categoryId");
    const search = searchParams.get("search");
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20") || 20));

    const where: Record<string, unknown> = { isActive: true };

    if (categoryId) {
        where.categoryId = categoryId;
    }

    if (search) {
        where.OR = [
            { title: { contains: search, mode: "insensitive" } },
            { content: { contains: search, mode: "insensitive" } },
        ];
    }

    const articles = await prisma.helpArticle.findMany({
        where,
        take: limit,
        orderBy: { views: "desc" },
        include: {
            category: { select: { id: true, name: true, slug: true } },
        },
    });

    // Same reason as the single-article endpoint: the list page is a client
    // component, so a hidden view count is withheld here, not there.
    const { showViewCount } = await moduleSettings<{ showViewCount: boolean }>("help-center");

    return NextResponse.json(
        showViewCount ? articles : articles.map((a) => ({ ...a, views: null })),
    );
}

// POST /api/v1/help/articles - Create article (admin)
export async function POST(request: NextRequest) {
    const session = await auth();

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminCheck = await isAdmin(session.user.id);
    if (!adminCheck) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rl = await rateLimitForRole(
        `help-article-create:${session.user.id}`,
        { maxRequests: 10, windowMs: 60_000 },
        session.user.role
    );
    if (!rl.success) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = helpArticleSchema.safeParse(body);

    if (!validation.success) {
        return NextResponse.json(
            { error: "Validation failed", details: validation.error.flatten() },
            { status: 400 }
        );
    }

    const { title, slug, content, categoryId } = validation.data;
    const articleSlug = slug || slugify(title);

    const article = await prisma.helpArticle.create({
        data: {
            title,
            slug: articleSlug,
            content: content,
            categoryId,
        },
        include: {
            category: { select: { id: true, name: true, slug: true } },
        },
    });

    // Fire hook for cross-module reactions
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("helpcenter.article.created", article);

    // Public activity feed entry
    await prisma.activityFeedItem.create({
        data: {
            type: "helpcenter.article.created",
            actorId: session.user.id,
            title: `New help article: ${article.title}`,
            href: `/help/${article.slug}`,
            icon: "BookOpen",
            isPublic: true,
        },
    }).catch(() => {});

    return NextResponse.json(article, { status: 201 });
}
