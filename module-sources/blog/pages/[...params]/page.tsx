import { formatDate } from "@/core/sdk";
import { RichContent, buttonClassName } from "@/core/sdk/ui";
import { ArrangedPage, buildArticleJsonLd, moduleSettings, prisma, resolveAppUrl } from "@/core/sdk/server";
import { Link } from "@/core/sdk/navigation";
import { Slot } from "@/core/sdk/layout";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { ArticleContents } from "../../components/ArticleContents";
import { CommentSection } from "../../components/CommentSection";
import { dateLocaleTag } from "@/core/sdk";
import { publishedArticle } from "../../lib/visible-article";
import { readingMinutes } from "../../lib/reading-time";

interface PageProps {
    params: Promise<Record<string, unknown>>;
}

/** Resolve the article lookup key (slug or numeric id) from dynamic params. */
function extractLookup(resolved: Record<string, unknown>): string {
    const raw = (resolved.params as string | string[]) || (resolved.slug as string[]);
    const segments = typeof raw === "string" ? raw.split("/") : Array.isArray(raw) ? raw : [String(raw)];
    const blogIdx = segments.indexOf("blog");
    return blogIdx >= 0 && segments[blogIdx + 1] ? segments[blogIdx + 1] : segments[0];
}

async function getArticle(lookup: string) {
    const num = Number(lookup);
    const article = await prisma.blogArticle.findFirst({
        where: {
            ...(isNaN(num) ? { slug: lookup } : { number: num }),
            ...publishedArticle(),
        },
        include: {
            author: { select: { username: true, avatar: true } },
            category: { select: { name: true, slug: true } },
            tags: { select: { name: true, slug: true } },
        },
    });

    if (article) {
        // Increment view count
        await prisma.blogArticle.update({
            where: { id: article.id },
            data: { views: { increment: 1 } },
        });
    }

    return article;
}

async function getRelatedArticles(articleId: string, categoryId: string | null) {
    return prisma.blogArticle.findMany({
        where: {
            id: { not: articleId },
            ...publishedArticle(),
            ...(categoryId ? { categoryId } : {}),
        },
        take: 3,
        orderBy: { publishedAt: "desc" },
        select: {
            id: true,
            number: true,
            title: true,
            slug: true,
            coverImage: true,
            publishedAt: true,
        },
    });
}

/**
 * An article, built from the blocks `module.json` declares for the `post`
 * page: the article itself, a list of its sections, related articles and the
 * share buttons. A theme arranges them; with no word from the theme the page
 * stands as it always has, the article beside related and share.
 *
 * The cover and a line about the article are offered to the theme's header
 * as well. A theme whose header draws them turns them off in the article with
 * its `cover` and `meta` settings, so neither is drawn twice.
 */
export default async function BlogArticlePage({ params }: PageProps) {
    const resolvedParams = await params;
    const lookup = extractLookup(resolvedParams);
    const article = await getArticle(lookup);

    if (!article) {
        notFound();
    }

    const relatedArticles = await getRelatedArticles(article.id, article.categoryId);
    const { allowComments } = await moduleSettings<{ allowComments: boolean }>("blog");
    const t = await getTranslations("blog");
    const newsT = await getTranslations("news");
    const dateTag = dateLocaleTag(await getLocale());
    const published = formatDate(article.publishedAt || article.createdAt, undefined, dateTag);

    // A share link has to be absolute or it shares nothing: the old fallback
    // was the empty string, which handed X and Facebook a path with no
    // host on any install that had not set AUTH_URL.
    const articleUrl = `${resolveAppUrl()}/blog/${article.number}/${article.slug}`;
    const shareX = `https://x.com/intent/post?url=${encodeURIComponent(articleUrl)}&text=${encodeURIComponent(article.title)}`;
    const shareFacebook = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(articleUrl)}`;

    const articleJsonLd = buildArticleJsonLd({
        title: article.title,
        description: article.excerpt || undefined,
        image: article.coverImage || undefined,
        url: `/blog/${article.slug}`,
        datePublished: article.publishedAt?.toISOString(),
        dateModified: article.updatedAt?.toISOString(),
        authorName: article.author?.username ?? "Unknown",
    });

    const categoryTag = article.category ? (
        <Link
            href={`/blog?category=${encodeURIComponent(article.category.slug)}`}
            className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
        >
            {article.category.name}
        </Link>
    ) : null;

    // What a theme's header may draw under the title: the section, when it
    // was published and how long it reads, and who wrote it.
    const meta = (
        <span data-article-meta className="flex flex-wrap items-center gap-3">
            {categoryTag}
            <span>{published} · {newsT("readingTime", { minutes: readingMinutes(article.content) })}</span>
            {article.author ? <span data-article-author>{article.author.username}</span> : null}
        </span>
    );

    return (
        <ArrangedPage
            page="blog.post"
            frame={{
                title: article.title,
                trail: [
                    { label: t("breadcrumb"), href: "/blog" },
                    ...(article.category
                        ? [{ label: article.category.name, href: `/blog?category=${encodeURIComponent(article.category.slug)}` }]
                        : []),
                ],
                picture: article.coverImage ?? undefined,
                meta,
            }}
            blocks={{
                article: ({ settings }) => (
                    <article className="bg-card rounded-xl border border-border overflow-hidden">
                        {settings.cover !== false && article.coverImage && (
                            <div className="h-64 md:h-96 overflow-hidden">
                                <Image
                                    src={article.coverImage}
                                    alt={article.title}
                                    width={0}
                                    height={0}
                                    sizes="100vw"
                                    className="w-full h-full object-cover"
                                />
                            </div>
                        )}
                        <div className="p-6 md:p-8">
                            {settings.meta !== false && (
                                <>
                                    {/* Meta */}
                                    <div className="flex items-center gap-4 mb-4">
                                        {categoryTag}
                                        <span className="text-sm text-muted-foreground">{published}</span>
                                        <span className="text-sm text-muted-foreground">
                                            {t("views", { count: article.views })}
                                        </span>
                                    </div>

                                    {/* Author (may be null when account was deleted) */}
                                    {article.author && (
                                        <div className="flex items-center gap-3 mb-8 pb-8 border-b border-border">
                                            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground font-bold">
                                                {article.author.avatar ? (
                                                    <Image src={article.author.avatar} alt={article.author.username} width={40} height={40} className="w-full h-full rounded-full object-cover" />
                                                ) : (
                                                    article.author.username.charAt(0).toUpperCase()
                                                )}
                                            </div>
                                            <div>
                                                <p className="font-medium text-foreground">{article.author.username}</p>
                                                <p className="text-sm text-muted-foreground">{t("author")}</p>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Slot: above article content - e.g. related products, author box, ad */}
                            <Slot name="blog.article.aboveContent" context={{ articleId: article.id, articleSlug: article.slug }} />

                            {/* Content - RichTextEditor stores HTML, sanitize before
                                render. The list of sections reads its headings
                                from `data-article-body`. */}
                            <div data-article-body>
                                <RichContent
                                    className="text-lg"
                                    markdown={article.content}
                                />
                            </div>

                            {/* Slot: below article content */}
                            <Slot name="blog.article.belowContent" context={{ articleId: article.id, articleSlug: article.slug }} />

                            {/* Tags */}
                            {article.tags.length > 0 && (
                                <div className="mt-8 pt-8 border-t border-border">
                                    <div className="flex flex-wrap gap-2">
                                        {article.tags.map((tag) => (
                                            <Link
                                                key={tag.slug}
                                                href={`/blog?tag=${encodeURIComponent(tag.slug)}`}
                                                className="px-3 py-1 rounded-full bg-muted text-foreground text-sm hover:bg-muted/70 transition-colors"
                                            >
                                                #{tag.name}
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Comment Section */}
                            {allowComments && (
                                <div className="mt-8 pt-8 border-t border-border">
                                    <CommentSection articleId={article.id} />
                                </div>
                            )}
                        </div>
                    </article>
                ),
                contents: () => (
                    <div className="bg-card rounded-xl border border-border p-5 empty:hidden">
                        <ArticleContents />
                    </div>
                ),
                related: () => (relatedArticles.length > 0 ? (
                    <div className="bg-card rounded-xl border border-border p-5">
                        <h2 className="font-bold text-foreground mb-4">{t("relatedArticles")}</h2>
                        <div className="space-y-4">
                            {relatedArticles.map((related) => (
                                <Link
                                    key={related.id}
                                    href={`/blog/${related.number}/${related.slug}`}
                                    className="block group"
                                >
                                    {related.coverImage && (
                                        <div className="h-24 rounded-lg overflow-hidden mb-2">
                                            <Image
                                                src={related.coverImage}
                                                alt={related.title}
                                                width={0}
                                                height={0}
                                                sizes="100vw"
                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                            />
                                        </div>
                                    )}
                                    <h3 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2">
                                        {related.title}
                                    </h3>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {formatDate(related.publishedAt || new Date(), undefined, dateTag)}
                                    </p>
                                </Link>
                            ))}
                        </div>
                    </div>
                ) : null),
                share: () => (
                    <div className="bg-card rounded-xl border border-border p-5">
                        <h2 className="font-bold text-foreground mb-4">{t("share")}</h2>
                        <div className="flex gap-2">
                            <a
                                href={shareX}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={buttonClassName("default", "default", "flex-1")}
                            >
                                X
                            </a>
                            <a
                                href={shareFacebook}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={buttonClassName("default", "default", "flex-1")}
                            >
                                Facebook
                            </a>
                        </div>
                    </div>
                ),
            }}
        >
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: articleJsonLd }}
            />
        </ArrangedPage>
    );
}
