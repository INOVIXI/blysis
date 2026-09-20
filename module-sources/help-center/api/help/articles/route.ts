import { NextRequest, NextResponse } from "next/server";
import { slugify } from "@/core/sdk";
import { isAdmin, moduleSettings, pageParams, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { helpArticleSchema } from "../../../lib/validations";

/**
 * GET /api/v1/help/articles - the published list, and the operator's list.
 *
 * Two readers with opposite needs were being served one answer, and it was
 * the visitor's. The panel read this endpoint and got `isActive: true`, the
 * twenty most-read, and a view count blanked out whenever the operator had
 * turned view counts off for visitors. So an article somebody deactivated
 * vanished from the screen that could have brought it back, a help centre
 * with twenty-one articles showed twenty and said nothing, and the Views
 * column on the panel went empty for a setting about the public page.
 *
 * `scope=admin` is the operator's answer: everything, hidden ones included,
 * newest first, paged, with the counts as they stand. It is refused to
 * anybody who could not open the screen that asks for it.
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get("categoryId");
    const search = searchParams.get("search");

    if (searchParams.get("scope") === "admin") return adminList(searchParams);

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

/**
 * The panel's list: paged by the database rather than by the browser.
 *
 * The screen used to read whatever arrived and search and sort it in place,
 * which answers over one page - the same mistake the orders screen made, and
 * the reason a refund nobody could find looked like a refund that never
 * happened. What is asked for goes to the query.
 */
async function adminList(searchParams: URLSearchParams) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { page, limit, skip, take } = pageParams(searchParams, { limitParam: "perPage", defaultLimit: 25 });
    const search = searchParams.get("search")?.trim() || "";
    const categoryId = searchParams.get("categoryId") || "";
    const sort = searchParams.get("sort");

    const where: Record<string, unknown> = {};
    if (categoryId) where.categoryId = categoryId;
    if (search) {
        where.OR = [
            { title: { contains: search, mode: "insensitive" } },
            { slug: { contains: search, mode: "insensitive" } },
        ];
    }

    /*
     * Ordering by what an operator asked to see. "Worst first" is the reason
     * the helpfulness column exists - it is how you find the article that is
     * failing readers - and sorting the rows already in the browser answered
     * it over one page of them.
     *
     * The share itself is not a column, so the database cannot order by it.
     * Ordering by the votes against, then by the votes for, puts the article
     * people said no to at the top, which is the question being asked.
     */
    const orderBy =
        sort === "worst" ? [{ notHelpful: "desc" as const }, { helpful: "asc" as const }]
        : sort === "best" ? [{ helpful: "desc" as const }, { notHelpful: "asc" as const }]
        : [{ createdAt: "desc" as const }];

    const [articles, total] = await Promise.all([
        prisma.helpArticle.findMany({
            where,
            orderBy,
            skip,
            take,
            include: { category: { select: { id: true, name: true, slug: true } } },
        }),
        prisma.helpArticle.count({ where }),
    ]);

    return NextResponse.json({
        articles,
        pagination: { page, perPage: limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
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

    const { title, slug, content, categoryId, isActive } = validation.data;
    const articleSlug = slug || slugify(title);

    const article = await prisma.helpArticle.create({
        data: {
            title,
            slug: articleSlug,
            content: content,
            categoryId,
            isActive: isActive ?? true,
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
