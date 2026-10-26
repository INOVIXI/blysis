import { formatDate } from "@/core/sdk";
import { prisma } from "@/core/sdk/server";
import { Link } from "@/core/sdk/navigation";
import { ArrangedPage } from "@/core/sdk/page";
import { Pagination } from "@/core/sdk/ui";
import { NewsGrid } from "../components/news-grid";
import { getTranslations, getLocale } from "next-intl/server";
import { dateLocaleTag } from "@/core/sdk";
import { publishedArticle } from "../lib/visible-article";

export const revalidate = 60;

/**
 * One page of articles.
 *
 * The index used to read every published article, with its author and its
 * category joined, and render all of them into one grid. That is the whole
 * table on every visit, and it grows for the life of the site while the page
 * only ever shows a screenful.
 */
const PER_PAGE = 12;

interface Filter {
    category?: string;
    tag?: string;
}

/**
 * The sidebar has always listed the categories, and every article has always
 * shown its category and its tags as links. All of them pointed at
 * `/blog/category/<slug>` and `/blog/tag/<slug>`, which no route serves: the
 * `[...params]` catch-all reads the segment after `blog` as an article lookup,
 * so every one of those links looked up an article called "category" and
 * answered 404. The whole of the blog's browsing was dead.
 *
 * One grid can do the job, so the filter is a query parameter on this page
 * rather than two more routes, and paging keeps it.
 */
async function getBlogArticles(page: number, filter: Filter) {
    const where = {
        ...publishedArticle(),
        ...(filter.category ? { category: { slug: filter.category } } : {}),
        ...(filter.tag ? { tags: { some: { slug: filter.tag } } } : {}),
    } as const;

    const [articles, total, categories, recent, activeCategory, activeTag] = await Promise.all([
        prisma.blogArticle.findMany({
            where,
            orderBy: { publishedAt: "desc" },
            skip: (page - 1) * PER_PAGE,
            take: PER_PAGE,
            include: {
                author: { select: { username: true, avatar: true } },
                category: { select: { name: true, slug: true } },
            },
        }),
        prisma.blogArticle.count({ where }),
        // The number beside a category is what opening it shows, so it counts
        // what the listing counts: drafts and scheduled articles made a
        // category read "3" over a page of one.
        prisma.blogCategory.findMany({
            include: {
                _count: { select: { articles: { where: publishedArticle() } } },
            },
        }),
        // The sidebar wants the five newest on every page, not the five that
        // happen to be at the top of the page being viewed.
        prisma.blogArticle.findMany({
            where: publishedArticle(),
            orderBy: { publishedAt: "desc" },
            take: 5,
            select: { id: true, number: true, slug: true, title: true, publishedAt: true, createdAt: true },
        }),
        filter.category
            ? prisma.blogCategory.findUnique({ where: { slug: filter.category }, select: { name: true } })
            : Promise.resolve(null),
        filter.tag
            ? prisma.blogTag.findUnique({ where: { slug: filter.tag }, select: { name: true } })
            : Promise.resolve(null),
    ]);

    return {
        articles,
        categories,
        recent,
        pages: Math.max(1, Math.ceil(total / PER_PAGE)),
        activeName: activeCategory?.name ?? activeTag?.name ?? null,
    };
}

/**
 * `/blog`, with the filter kept in the query string.
 *
 * It used to carry the page number too, for a pager written here by hand.
 * `Pagination` builds its own hrefs from the live query, so a filtered page
 * two keeps the filter without this having to know about it.
 */
function blogHref(filter: Filter): string {
    const query = new URLSearchParams();
    if (filter.category) query.set("category", filter.category);
    if (filter.tag) query.set("tag", filter.tag);
    const qs = query.toString();
    return qs ? `/blog?${qs}` : "/blog";
}

interface BlogPageProps {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const one = (v: string | string[] | undefined): string | undefined => {
    const value = Array.isArray(v) ? v[0] : v;
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
};

export default async function BlogPage({ searchParams }: BlogPageProps) {
    const query = (await searchParams) ?? {};
    const requested = Number.parseInt(one(query.page) ?? "", 10);
    const page = Number.isFinite(requested) && requested > 0 ? requested : 1;
    const filter: Filter = { category: one(query.category), tag: one(query.tag) };
    const { articles, categories, recent, pages, activeName } = await getBlogArticles(page, filter);
    const t = await getTranslations('blog');
    const dateTag = dateLocaleTag(await getLocale());

    return (
        <ArrangedPage
            page="blog.list"
            frame={{
                title: activeName ?? t('title'),
                trail: activeName ? [{ label: t('title'), href: '/blog' }] : [],
            }}
            blocks={{
                back: () => (
                    filter.category || filter.tag ? (
                        <p className="text-sm text-muted-foreground">
                            <Link href="/blog" className="text-primary hover:underline">{t('allArticles')}</Link>
                        </p>
                    ) : null
                ),
                articles: () => (
                    articles.length === 0 ? (
                        <div className="bg-card rounded-xl p-12 text-center space-y-3">
                            <p className="text-muted-foreground">{t('noArticles')}</p>
                            {(filter.category || filter.tag) && (
                                <Link href="/blog" className="text-sm text-primary hover:underline">{t('allArticles')}</Link>
                            )}
                        </div>
                    ) : (
                        <>
                            <NewsGrid posts={articles} />
                            <Pagination page={page} pages={pages} pageParam="page" className="mt-4" />
                        </>
                    )
                ),
                // A card with a heading and nothing under it is what a new blog
                // showed twice, below the articles on a phone. Each card draws
                // only with something in it, and no sidebar at all without either.
                sidebar: () => (
                    categories.length > 0 || recent.length > 0 ? (
                        <aside className="space-y-6">
                            {categories.length > 0 && (
                                <div className="bg-card rounded-xl border border-border p-5">
                                    <h2 className="font-bold text-foreground mb-4">{t('categories')}</h2>
                                    <div className="space-y-2">
                                        {categories.map((category) => (
                                            <Link
                                                key={category.id}
                                                href={blogHref({ category: category.slug })}
                                                aria-current={filter.category === category.slug ? "page" : undefined}
                                                className={`flex items-center justify-between p-2 rounded-lg transition-colors ${filter.category === category.slug ? "bg-muted font-medium" : "hover:bg-muted"}`}
                                            >
                                                <span className="text-foreground">{category.name}</span>
                                                <span className="text-sm text-muted-foreground">
                                                    {category._count.articles}
                                                </span>
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {recent.length > 0 && (
                                <div className="bg-card rounded-xl border border-border p-5">
                                    <h2 className="font-bold text-foreground mb-4">{t('recentPosts')}</h2>
                                    <div className="space-y-4">
                                        {recent.map((article) => (
                                            <Link
                                                key={article.id}
                                                href={`/blog/${article.number}/${article.slug}`}
                                                className="block group"
                                            >
                                                <h3 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2">
                                                    {article.title}
                                                </h3>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    {formatDate(article.publishedAt || article.createdAt, undefined, dateTag)}
                                                </p>
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </aside>
                    ) : null
                ),
            }}
        />
    );
}
