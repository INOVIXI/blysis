import { NextRequest, NextResponse } from "next/server";
import { hasPermission, moduleSettings, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { blogCommentSchema } from "../../lib/validations";
import { publishedArticle } from "../../lib/visible-article";

type ModerationSettingValue = {
    blog_comments?: "auto" | "manual";
    forum_topics?: "auto" | "manual";
    forum_posts?: "auto" | "manual";
    suggestions?: "auto" | "manual";
};

async function getModerationMode(field: keyof ModerationSettingValue): Promise<"auto" | "manual"> {
    const setting = await prisma.setting.findUnique({ where: { key: "moderation" } });
    const value = (setting?.value ?? {}) as ModerationSettingValue;
    return value[field] === "manual" ? "manual" : "auto";
}

/**
 * The most comments one response will carry. An article's comment list is
 * anonymous-readable and grows with every visitor who posts, so reading all of
 * it was a query and a response with no ceiling. `?limit=` asks for fewer.
 */
const DEFAULT_COMMENT_LIMIT = 50;
const MAX_COMMENT_LIMIT = 200;

// GET /api/v1/blog/comments?articleId=xxx&limit=50 - List comments for an article
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const articleId = searchParams.get("articleId");

    if (!articleId) {
        return NextResponse.json(
            { error: "Article ID is required" },
            { status: 400 }
        );
    }

    const requested = Number(searchParams.get("limit"));
    const limit = Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), MAX_COMMENT_LIMIT)
        : DEFAULT_COMMENT_LIMIT;

    // With comments switched off the article page hides the section, but the
    // endpoint is public: it has to stop publishing them too, or turning the
    // setting off would only hide them from people who use a browser.
    const { allowComments } = await moduleSettings<{ allowComments: boolean }>("blog");
    if (!allowComments) return NextResponse.json([]);

    const session = await auth();
    const adminCheck = session?.user?.id ? await hasPermission(session.user.id, "blog.manage") : false;

    // The comments of an article nobody may read are not public either. An
    // administrator is exempt for the same reason they see PENDING comments:
    // the moderation screen reads this endpoint. Asked before the comments,
    // since a list that cannot be shown is a query worth not running.
    if (!adminCheck) {
        const visible = await prisma.blogArticle.findFirst({
            where: { id: articleId, ...publishedArticle() },
            select: { id: true },
        });
        if (!visible) {
            return NextResponse.json({ error: "Article not found" }, { status: 404 });
        }
    }

    const comments = await prisma.blogComment.findMany({
        where: {
            articleId,
            isApproved: true,
            ...(adminCheck ? {} : { moderationState: "APPROVED" }),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
            author: {
                select: { id: true, username: true, avatar: true },
            },
        },
    });

    return NextResponse.json(comments);
}

// POST /api/v1/blog/comments - Create a new comment
export async function POST(request: NextRequest) {
    const session = await auth();

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { allowComments } = await moduleSettings<{ allowComments: boolean }>("blog");
    if (!allowComments) {
        return NextResponse.json({ error: "Comments are closed" }, { status: 403 });
    }

    const rl = await rateLimitForRole(
        `blog-comment:${session.user.id}`,
        { maxRequests: 10, windowMs: 3_600_000 },
        session.user.role
    );
    if (!rl.success) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const validation = blogCommentSchema.safeParse(body);

    if (!validation.success) {
        return NextResponse.json(
            { error: "Validation failed", details: validation.error.flatten() },
            { status: 400 }
        );
    }

    const { content, articleId } = validation.data;

    // The article has to be one a visitor could have read, not merely a row
    // that exists: an article pulled back to a draft keeps the id it had while
    // it was public, and every reading door in this module already refuses it.
    const article = await prisma.blogArticle.findFirst({
        where: { id: articleId, ...publishedArticle() },
        select: { id: true },
    });

    if (!article) {
        return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    const mode = await getModerationMode("blog_comments");
    const moderationState = mode === "manual" ? "PENDING" : "APPROVED";

    const comment = await prisma.blogComment.create({
        data: {
            content,
            articleId,
            authorId: session.user.id,
            isApproved: moderationState === "APPROVED",
            moderationState,
        },
        include: {
            author: {
                select: { id: true, username: true, avatar: true },
            },
        },
    });

    return NextResponse.json(comment, { status: 201 });
}
