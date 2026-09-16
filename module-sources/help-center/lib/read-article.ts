/**
 * One article and the other articles beside it.
 *
 * The page that shows an article is a client component and fetched it on
 * mount, so none of an article - not the title, not a word of the text - was
 * ever in the HTML the server sent. All 30 articles the sitemap publishes were
 * empty pages to a reader without JavaScript and to anything that indexes one.
 *
 * The page renders this on the server now; the endpoint still exists for
 * whatever reads it over HTTP, and calls the same function. What a reader may
 * see - the view count is a setting - is decided here, once, because a count
 * the site hides and the JSON still carries is not hidden.
 */
import { headers } from "next/headers";
import { moduleSettings, prisma } from "@/core/sdk/server";

export interface ArticleRead {
    article: {
        id: string;
        title: string;
        slug: string;
        content: string;
        /** Null when the site has turned view counts off. */
        views: number | null;
        helpful: number;
        notHelpful: number;
        category: { id: string; name: string; slug: string };
    };
    settings: { showViewCount: boolean; enableFeedback: boolean };
    /** The rest of this category, for reading on. */
    neighbours: { id: string; slug: string; title: string }[];
}

export async function readArticle(slug: string): Promise<ArticleRead | null> {
    const article = await prisma.helpArticle.findUnique({
        where: { slug },
        include: { category: { select: { id: true, name: true, slug: true } } },
    });
    if (!article || !article.isActive || !article.category) return null;

    const { showViewCount, enableFeedback } = await moduleSettings<{
        showViewCount: boolean;
        enableFeedback: boolean;
    }>("help-center");

    const neighbours = await prisma.helpArticle.findMany({
        where: { categoryId: article.categoryId, isActive: true },
        select: { id: true, slug: true, title: true },
        // The same order the list endpoint uses, so the column beside an article
        // reads the way the category page did.
        orderBy: { views: "desc" },
        take: 50,
    });

    return {
        article: {
            id: article.id,
            title: article.title,
            slug: article.slug,
            content: article.content,
            views: showViewCount ? article.views : null,
            helpful: article.helpful,
            notHelpful: article.notHelpful,
            category: article.category,
        },
        settings: { showViewCount, enableFeedback },
        neighbours,
    };
}

/**
 * One more view, unless nobody is looking yet. A server component runs on the
 * router's prefetch as well, and a hover over a link in the category list
 * would otherwise count as a reader.
 */
export async function countArticleView(articleId: string): Promise<void> {
    if ((await headers()).get("next-router-prefetch")) return;
    await prisma.helpArticle.update({ where: { id: articleId }, data: { views: { increment: 1 } } });
}

export interface HelpIndexRead {
    categories: { id: string; name: string; slug: string; description: string | null; icon: string | null; articleCount: number }[];
    popular: { id: string; slug: string; title: string }[];
}

/**
 * The help centre's front page.
 *
 * It fetched its categories and its popular articles after the page had
 * loaded, so the HTML the server sent held no link to a single article or a
 * single section: measured, the page answered with 17 links and every one of
 * them was the shared header and footer. The 30 articles the sitemap publishes
 * had no path into them from anywhere on the site.
 */
export async function readHelpIndex(): Promise<HelpIndexRead> {
    const [categories, popular] = await Promise.all([
        prisma.helpCategory.findMany({
            where: { isActive: true },
            orderBy: { order: "asc" },
            take: 100,
            select: {
                id: true, name: true, slug: true, description: true, icon: true,
                _count: { select: { articles: true } },
            },
        }),
        prisma.helpArticle.findMany({
            where: { isActive: true },
            orderBy: { views: "desc" },
            take: 5,
            select: { id: true, slug: true, title: true },
        }),
    ]);

    return {
        categories: categories.map(({ _count, ...category }) => ({ ...category, articleCount: _count.articles })),
        popular,
    };
}

export interface HelpCategoryRead {
    category: { id: string; name: string; slug: string; description: string | null };
    articles: { id: string; slug: string; title: string; views: number | null }[];
}

/** One section and everything filed in it. */
export async function readHelpCategory(slug: string): Promise<HelpCategoryRead | null> {
    const category = await prisma.helpCategory.findFirst({
        where: { slug, isActive: true },
        select: { id: true, name: true, slug: true, description: true },
    });
    if (!category) return null;

    const { showViewCount } = await moduleSettings<{ showViewCount: boolean }>("help-center");
    const articles = await prisma.helpArticle.findMany({
        where: { categoryId: category.id, isActive: true },
        orderBy: { views: "desc" },
        take: 200,
        select: { id: true, slug: true, title: true, views: true },
    });

    return {
        category,
        articles: articles.map((article) => ({ ...article, views: showViewCount ? article.views : null })),
    };
}

/** What a reader typed in the band at the top, answered by the server. */
export async function searchHelpArticles(query: string) {
    const term = query.trim();
    if (!term) return [];
    return prisma.helpArticle.findMany({
        where: {
            isActive: true,
            OR: [
                { title: { contains: term, mode: "insensitive" } },
                { content: { contains: term, mode: "insensitive" } },
            ],
        },
        orderBy: { views: "desc" },
        take: 25,
        select: { id: true, slug: true, title: true, category: { select: { name: true } } },
    });
}
