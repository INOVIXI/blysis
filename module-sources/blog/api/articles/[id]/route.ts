import { NextRequest, NextResponse } from "next/server";
import { generateSlug } from "@/core/sdk";
import { attachContentTranslations, contentTranslationsInput, deleteContentTranslations, hasPermission, prisma, readJsonBody, saveContentTranslations } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { blogArticleSchema } from "../../../lib/validations";
import { ARTICLE_FIELDS, ARTICLE_TEXT, articlesIn, localeOf } from "../../../lib/blog-text";
import { isPublishedArticle } from "../../../lib/visible-article";

interface RouteParams {
    params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/blog/articles/[id] - Get single article.
 *
 * `?locale=` reads it, and its category, in the reader's language.
 * `?scope=admin` is the editor's answer: the originals with every language
 * beside them, refused to anybody who may not edit the article.
 */
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

    // A reader gets what was published, by the rule every other door reads
    // through. This one tested only a future `publishAt`, so a draft, an
    // archived article or one pulled back came back whole to anybody counting
    // through the numbers. Reading one before it is out is an editorial act:
    // its author, and whoever may publish or edit any article.
    const session = await auth();
    if (!isPublishedArticle(article)) {
        const userId = session?.user?.id;
        const editorial = userId !== undefined && (
            article.authorId === userId
            || await hasPermission(userId, "blog.publish")
            || await hasPermission(userId, "blog.edit-any")
        );
        if (!editorial) return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    if (new URL(request.url).searchParams.get("scope") === "admin") {
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const mayEdit = article.authorId === session.user.id || await hasPermission(session.user.id, "blog.edit-any");
        if (!mayEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        const [withLanguages] = await attachContentTranslations(prisma, ARTICLE_TEXT, [article]);
        return NextResponse.json(withLanguages);
    }

    const [read] = await articlesIn([article], localeOf(request));
    return NextResponse.json(read);
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
    const isAuthor = article.authorId === session.user.id;
    const [mayEditAny, mayPublish] = await Promise.all([
        hasPermission(session.user.id, "blog.edit-any"),
        hasPermission(session.user.id, "blog.publish"),
    ]);
    if (!isAuthor && !mayEditAny) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = blogArticleSchema.partial().safeParse(body);

    if (!validation.success) {
        return NextResponse.json(
            { error: "Validation failed", details: validation.error.flatten() },
            { status: 400 }
        );
    }

    const translations = contentTranslationsInput(body, ARTICLE_FIELDS);
    if (!translations.ok) return NextResponse.json({ error: translations.error }, { status: 400 });

    const { title, slug: requestedSlug, excerpt, content, coverImage, status, publishedAt, publishAt, categoryId, tags } = validation.data;

    // Writing is not publishing. A writer may draft and edit; releasing an
    // article - or scheduling it, which is releasing it later - is the
    // editor's act, and an author without that permission keeps the status
    // the article already has.
    if (!mayPublish && (status !== undefined || publishAt !== undefined)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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

    // Snapshot the previous state for rollback, once the edit is certain to
    // be written: taken before the body was read, every refused edit left a
    // copy of the article in its history.
    const { recordRevision } = await import("@/core/sdk/server");
    await recordRevision("blog.article", id, article, "update", session.user.id);

    const updatedArticle = await prisma.$transaction(async (tx) => {
        const updated = await tx.blogArticle.update({
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
        if (translations.value) await saveContentTranslations(tx, { ...ARTICLE_TEXT, recordId: id }, translations.value);
        return updated;
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

    if (
        article.authorId !== session.user.id &&
        !(await hasPermission(session.user.id, "blog.edit-any"))
    ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Snapshot the deleted entity for potential restore
    const { recordRevision } = await import("@/core/sdk/server");
    await recordRevision("blog.article", id, article, "delete", session.user.id);

    await prisma.$transaction(async (tx) => {
        await tx.blogArticle.delete({ where: { id } });
        await deleteContentTranslations(tx, ARTICLE_TEXT, [id]);
    });

    const { doActionAsync } = await import("@/core/sdk");
    await doActionAsync("blog.article.deleted", article);

    return NextResponse.json({ message: "Article deleted successfully" });
}
