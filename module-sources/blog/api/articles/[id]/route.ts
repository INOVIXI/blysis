import { NextRequest, NextResponse } from "next/server";
import { generateSlug } from "@/core/sdk";
import { isAdmin, prisma, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { blogArticleSchema } from "../../../lib/validations";

interface RouteParams {
    params: Promise<{ id: string }>;
}

// GET /api/v1/blog/articles/[id] - Get single article
export async function GET(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;

    const article = await prisma.blogArticle.findFirst({
        where: {
            OR: [{ id }, { slug: id }, ...(isNaN(Number(id)) ? [] : [{ number: Number(id) }])],
        },
        include: {
            author: { select: { id: true, username: true, avatar: true } },
            category: { select: { id: true, name: true, slug: true } },
            tags: { select: { id: true, name: true, slug: true } },
            comments: {
                where: { isApproved: true, moderationState: "APPROVED" },
                orderBy: { createdAt: "desc" },
                include: {
                    author: { select: { id: true, username: true, avatar: true } },
                },
            },
        },
    });

    if (!article) {
        return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    // Non-admins cannot see scheduled/future articles
    const session = await auth();
    const adminCheck = session?.user?.id ? await isAdmin(session.user.id) : false;
    if (!adminCheck && article.publishAt && article.publishAt.getTime() > Date.now()) {
        return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    return NextResponse.json(article);
}

// PATCH /api/v1/blog/articles/[id] - Update article (author or admin)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const article = await prisma.blogArticle.findUnique({
        where: { id },
        include: { tags: true, category: true },
    });
    if (!article) {
        return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    // Object-level ownership: authors can edit their own article; admins can
    // edit any article. Checked BEFORE pulling the request body so a
    // non-owner never hits the update path at all.
    const adminCheck = await isAdmin(session.user.id);
    const isAuthor = article.authorId === session.user.id;
    if (!adminCheck && !isAuthor) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Snapshot the previous state for rollback
    const { recordRevision } = await import("@/core/sdk/server");
    await recordRevision("blog.article", id, article, "update", session.user.id);

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = blogArticleSchema.partial().safeParse(body);

    if (!validation.success) {
        return NextResponse.json(
            { error: "Validation failed", details: validation.error.flatten() },
            { status: 400 }
        );
    }

    const { title, slug: requestedSlug, excerpt, content, coverImage, status, publishedAt, publishAt, categoryId, tags } = validation.data;

    // Resolve scheduled-publishing state
    let effectiveStatus = status;
    let publishAtDate: Date | null | undefined = undefined;
    if (publishAt !== undefined) {
        publishAtDate = publishAt ? new Date(publishAt) : null;
        if (publishAtDate !== null && publishAtDate.getTime() > Date.now()) {
            effectiveStatus = "SCHEDULED";
        }
    }

    // Auto-stamp publishedAt when the article is being flipped to
    // PUBLISHED for the first time. If the row already has a
    // publishedAt, preserve it (republishing shouldn't shift the date);
    // if the caller explicitly provided publishedAt, that wins.
    let effectivePublishedAt: Date | undefined | null = publishedAt ? new Date(publishedAt) : undefined;
    if (
        effectivePublishedAt === undefined &&
        effectiveStatus === "PUBLISHED" &&
        !article.publishedAt
    ) {
        effectivePublishedAt = new Date();
    }

    // Generate new slug if title changed
    let slug = article.slug;
    if (title && title !== article.title) {
        slug = requestedSlug || generateSlug(title);
        const existingSlug = await prisma.blogArticle.findFirst({
            where: { slug, id: { not: id } },
        });
        if (existingSlug) {
            return NextResponse.json({ error: "Slug already exists" }, { status: 400 });
        }
    }

    // Handle tags update
    let tagUpdate = {};
    if (tags !== undefined) {
        tagUpdate = {
            tags: {
                set: [],
                connectOrCreate: tags.map((tagName: string) => ({
                    where: { slug: generateSlug(tagName) },
                    create: { name: tagName, slug: generateSlug(tagName) },
                })),
            },
        };
    }

    const updatedArticle = await prisma.blogArticle.update({
        where: { id },
        data: {
            title,
            slug,
            excerpt,
            content: content !== undefined ? content : undefined,
            coverImage,
            status: effectiveStatus,
            publishedAt: effectivePublishedAt,
            publishAt: publishAtDate,
            categoryId,
            ...tagUpdate,
        },
        include: {
            author: { select: { id: true, username: true, avatar: true } },
            category: true,
            tags: true,
        },
    });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("blog.article.updated", updatedArticle);

    return NextResponse.json(updatedArticle);
}

// DELETE /api/v1/blog/articles/[id] - Delete article (author or admin)
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
    const session = await auth();
    const { id } = await params;

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const article = await prisma.blogArticle.findUnique({
        where: { id },
        include: { tags: true, category: true },
    });
    if (!article) {
        return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    const adminCheck = await isAdmin(session.user.id);
    const isAuthor = article.authorId === session.user.id;
    if (!adminCheck && !isAuthor) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Snapshot the deleted entity for potential restore
    const { recordRevision } = await import("@/core/sdk/server");
    await recordRevision("blog.article", id, article, "delete", session.user.id);

    await prisma.blogArticle.delete({ where: { id } });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("blog.article.deleted", article);

    return NextResponse.json({ message: "Article deleted successfully" });
}
