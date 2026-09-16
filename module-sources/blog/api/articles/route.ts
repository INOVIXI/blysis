import { NextRequest, NextResponse } from "next/server";
import { generateSlug } from "@/core/sdk";
import { pageParams, enumParam, hasPermission, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { ARTICLE_STATUSES, blogArticleSchema } from "../../lib/validations";

// GET /api/v1/blog/articles - List all articles (public)
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const { page, limit, skip, take } = pageParams(searchParams, { defaultLimit: 10 });
    // BlogArticle.status is a Prisma enum: an unrecognised value is a thrown
    // validation error rather than an empty result, so it is answered here.
    const rawStatus = searchParams.get("status");
    const status = rawStatus === "ALL" ? "ALL" : enumParam(searchParams, "status", ARTICLE_STATUSES);
    if (status instanceof NextResponse) return status;
    const categoryId = searchParams.get("categoryId");


    const where: Record<string, unknown> = {};

    // Non-admin users can only see published articles
    const session = await auth();
    const adminCheck = session?.user?.id ? await hasPermission(session.user.id, "blog.manage") : false;

    if (!adminCheck) {
        where.status = "PUBLISHED";
        where.publishedAt = { lte: new Date() };
        where.OR = [{ publishAt: null }, { publishAt: { lte: new Date() } }];
    } else if (status && status !== "ALL") {
        where.status = status;
    } else if (!status) {
        where.status = "PUBLISHED";
    }

    if (categoryId) {
        where.categoryId = categoryId;
    }

    const [articles, total] = await Promise.all([
        prisma.blogArticle.findMany({
            where,
            skip,
            take,
            orderBy: { publishedAt: "desc" },
            include: {
                author: { select: { id: true, username: true, avatar: true } },
                category: { select: { id: true, name: true, slug: true } },
                tags: { select: { id: true, name: true, slug: true } },
            },
        }),
        prisma.blogArticle.count({ where }),
    ]);

    return NextResponse.json({
        articles,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    });
}

// POST /api/v1/blog/articles - Create new article (admin only)
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
    const validation = blogArticleSchema.safeParse(body);

    if (!validation.success) {
        return NextResponse.json(
            { error: "Validation failed", details: validation.error.flatten() },
            { status: 400 }
        );
    }

    const { title, slug: requestedSlug, excerpt, content, coverImage, status, publishedAt, publishAt, categoryId, tags } = validation.data;

    // If publishAt is in the future, force SCHEDULED status
    const publishAtDate = publishAt ? new Date(publishAt) : null;
    const scheduleInFuture = publishAtDate !== null && publishAtDate.getTime() > Date.now();
    const effectiveStatus = scheduleInFuture ? "SCHEDULED" : (status || "DRAFT");

    // Auto-stamp publishedAt when the caller marks the article PUBLISHED
    // but didn't supply a date. The public listing filters by
    // publishedAt <= now, so without this the article would never appear.
    const effectivePublishedAt = publishedAt
        ? new Date(publishedAt)
        : (effectiveStatus === "PUBLISHED" ? new Date() : null);

    // Generate slug from title
    const slug = requestedSlug || generateSlug(title);

    // Check if slug already exists
    const existingArticle = await prisma.blogArticle.findUnique({ where: { slug } });
    if (existingArticle) {
        return NextResponse.json({ error: "Slug already exists" }, { status: 400 });
    }

    // Connect or create tags
    const tagConnections = tags?.length
        ? {
            connectOrCreate: tags.map((tagName: string) => ({
                where: { slug: generateSlug(tagName) },
                create: { name: tagName, slug: generateSlug(tagName) },
            })),
        }
        : undefined;

    const article = await prisma.blogArticle.create({
        data: {
            title: title,
            slug,
            excerpt,
            content: content,
            coverImage,
            status: effectiveStatus,
            publishedAt: effectivePublishedAt,
            publishAt: publishAtDate,
            authorId: session.user.id,
            categoryId,
            tags: tagConnections,
        },
        include: {
            author: { select: { id: true, username: true, avatar: true } },
            category: true,
            tags: true,
        },
    });

    // Fire hook for cross-module reactions (discord webhook, notifications, etc.)
    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("blog.article.created", article);

    return NextResponse.json(article, { status: 201 });
}
