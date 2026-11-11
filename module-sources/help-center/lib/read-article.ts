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
import { moduleSettings, prisma, textContains, translateContent } from "@/core/sdk/server";
import { HELP_ARTICLE_TEXT, HELP_CATEGORY_TEXT } from "./validations";

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

/**
 * Each row's section under its name in the reader's language: one query for
 * the page, whatever number of sections it names.
 */
export async function withCategoryNames<T extends { category: { id: string; name: string } | null }>(
    rows: T[],
    locale: string,
): Promise<T[]> {
    const named = new Map<string, { id: string; name: string }>();
    for (const row of rows) if (row.category) named.set(row.category.id, { id: row.category.id, name: row.category.name });
    const read = await translateContent(prisma, HELP_CATEGORY_TEXT, [...named.values()], ["name"], locale);
    const names = new Map(read.map((category) => [category.id, category.name]));
    return rows.map((row) => (row.category
        ? { ...row, category: { ...row.category, name: names.get(row.category.id) ?? row.category.name } }
        : row));
}

/**
 * `locale` is the reader's language: the article, its section and the
 * articles beside it are read in it, and in the original where the admin
 * wrote no translation. Without one, the columns as they were typed.
 */
export async function readArticle(slug: string, locale = ""): Promise<ArticleRead | null> {
    const found = await prisma.helpArticle.findUnique({
        where: { slug },
        include: { category: { select: { id: true, name: true, slug: true } } },
    });
    if (!found || !found.isActive || !found.category) return null;
    const [translated] = await translateContent(prisma, HELP_ARTICLE_TEXT, [found], ["title", "content"], locale);
    const [article] = await withCategoryNames([translated], locale);

    const { showViewCount, enableFeedback } = await moduleSettings<{
        showViewCount: boolean;
        enableFeedback: boolean;
    }>("help-center");

    const beside = await prisma.helpArticle.findMany({
        where: { categoryId: article.categoryId, isActive: true },
        select: { id: true, slug: true, title: true },
        // The same order the list endpoint uses, so the column beside an article
        // reads the way the category page did.
        orderBy: { views: "desc" },
        take: 50,
    });
    const neighbours = await translateContent(prisma, HELP_ARTICLE_TEXT, beside, ["title"], locale);

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
export async function readHelpIndex(locale = ""): Promise<HelpIndexRead> {
    const [sections, mostRead] = await Promise.all([
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
    const [categories, popular] = await Promise.all([
        translateContent(prisma, HELP_CATEGORY_TEXT, sections, ["name", "description"], locale),
        translateContent(prisma, HELP_ARTICLE_TEXT, mostRead, ["title"], locale),
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
export async function readHelpCategory(slug: string, locale = ""): Promise<HelpCategoryRead | null> {
    const section = await prisma.helpCategory.findFirst({
        where: { slug, isActive: true },
        select: { id: true, name: true, slug: true, description: true },
    });
    if (!section) return null;
    const [category] = await translateContent(prisma, HELP_CATEGORY_TEXT, [section], ["name", "description"], locale);

    const { showViewCount } = await moduleSettings<{ showViewCount: boolean }>("help-center");
    const filed = await prisma.helpArticle.findMany({
        where: { categoryId: category.id, isActive: true },
        orderBy: { views: "desc" },
        take: 200,
        select: { id: true, slug: true, title: true, views: true },
    });
    const articles = await translateContent(prisma, HELP_ARTICLE_TEXT, filed, ["title"], locale);

    return {
        category,
        articles: articles.map((article) => ({ ...article, views: showViewCount ? article.views : null })),
    };
}

/**
 * The articles whose title or body says `term` in a translation, which a
 * search of the columns cannot see: a reader who types the English title of
 * an article written in Turkish still finds it. Any language, since the
 * site's search is asked with no reader's language.
 */
export async function articlesTranslatedAs(term: string): Promise<string[]> {
    const hits = await prisma.contentTranslation.findMany({
        where: { ...HELP_ARTICLE_TEXT, field: { in: ["title", "content"] }, text: { contains: term, mode: "insensitive" } },
        select: { recordId: true },
        take: 20,
    });
    return [...new Set(hits.map((hit) => hit.recordId))];
}

/**
 * What a reader typed in the band at the top, answered by the server. It
 * matches the original columns and every translation, and draws what it
 * found in the reader's language.
 */
export async function searchHelpArticles(query: string, locale = "") {
    const term = query.trim();
    if (!term) return [];
    const translated = await articlesTranslatedAs(term);
    const found = await prisma.helpArticle.findMany({
        where: {
            isActive: true,
            OR: [
                ...textContains(["title", "content"], term),
                ...(translated.length > 0 ? [{ id: { in: translated } }] : []),
            ],
        },
        orderBy: { views: "desc" },
        take: 25,
        select: { id: true, slug: true, title: true, category: { select: { id: true, name: true } } },
    });
    return withCategoryNames(await translateContent(prisma, HELP_ARTICLE_TEXT, found, ["title"], locale), locale);
}
