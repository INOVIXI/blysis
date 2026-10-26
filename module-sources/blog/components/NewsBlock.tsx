"use client";

import { useContext, useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Newspaper } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { Badge, BlockHeading, LoadFailed, Pagination, Waiting, buttonClassName, useBlockText, useLocalDate, type BlockProps } from "@/core/sdk/ui";
import { NewsCard, OutlineContext, type BlogCardArticle } from "./news-card";
import { readingMinutes } from "../lib/reading-time";

interface Article extends BlogCardArticle {
    content?: string | null;
}

/** Cards a grid page holds, and articles the featured shape shows. */
const PER_PAGE = 4;

function href(post: Article) {
    return `/blog/${post.number}/${post.slug}`;
}

/** A link to an article, which the outline's empty articles do not fetch ahead. */
function ArticleLink({ post, className, children }: { post: Article; className: string; children: ReactNode }) {
    const outline = useContext(OutlineContext);
    return <Link href={href(post)} prefetch={outline ? false : undefined} className={className}>{children}</Link>;
}

function Picture({ post, sizes }: { post: Article; sizes: string }) {
    return post.coverImage ? (
        <Image src={post.coverImage} alt="" fill sizes={sizes} className="object-cover" />
    ) : (
        <div className="flex h-full w-full items-center justify-center">
            <Newspaper className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
        </div>
    );
}

/** The newest article, large: picture, category, date and reading time, headline, summary. */
function Lead({ post }: { post: Article }) {
    const t = useTranslations("news");
    const formatDate = useLocalDate({ dateStyle: "long" });
    const date = post.publishedAt || post.createdAt;
    return (
        <article data-news-lead className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
            <div className="relative aspect-card overflow-hidden bg-muted">
                <Picture post={post} sizes="(max-width: 1024px) 100vw, 50vw" />
                {post.category ? <Badge tone="info" solid className="absolute left-3 top-3">{post.category.name}</Badge> : null}
            </div>
            <div className="flex flex-1 flex-col gap-2.5 p-5">
                <p className="text-xs font-semibold text-muted-foreground">
                    {date ? <time data-news-date dateTime={new Date(date).toISOString()}>{formatDate(date)}</time> : null}
                    {date ? <span data-news-separator aria-hidden="true"> · </span> : null}
                    {t("readingTime", { minutes: readingMinutes(post.content) })}
                </p>
                {/* Two lines of headline and three of summary, reserved on the
                    pair as a news card does: the summary follows a short
                    headline instead of starting below a hole, and the card
                    is as tall whatever the article says. */}
                <div className="flex min-h-[8.625rem] flex-col gap-2.5">
                    <h3 className="line-clamp-2 text-xl font-bold leading-7 text-foreground">
                        <ArticleLink post={post} className="hover:text-primary">{post.title}</ArticleLink>
                    </h3>
                    <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{post.excerpt}</p>
                </div>
                <ArticleLink post={post} className={`${buttonClassName("secondary", "default")} mt-auto self-start`}>{t("readMore")}</ArticleLink>
            </div>
        </article>
    );
}

/** One of the articles after the newest: a small picture, category, headline, date. */
function Row({ post }: { post: Article }) {
    const formatDate = useLocalDate({ dateStyle: "long" });
    const date = post.publishedAt || post.createdAt;
    return (
        // Tall enough for a category, two lines of headline and the date, so
        // a row is one height whichever of them an article has.
        <article data-news-row className="flex min-h-[7.75rem] overflow-hidden rounded-xl border border-border bg-card">
            <div className="relative w-[7.5rem] shrink-0 bg-muted">
                <Picture post={post} sizes="120px" />
            </div>
            <div className="flex min-w-0 flex-col justify-center gap-1.5 px-4 py-3">
                {post.category ? <Badge tone="info" solid className="self-start">{post.category.name}</Badge> : null}
                <h3 className="line-clamp-2 font-bold leading-6 text-foreground">
                    <ArticleLink post={post} className="hover:text-primary">{post.title}</ArticleLink>
                </h3>
                {date ? <p className="text-xs text-muted-foreground"><time data-news-date dateTime={new Date(date).toISOString()}>{formatDate(date)}</time></p> : null}
            </div>
        </article>
    );
}

function Featured({ posts }: { posts: Article[] }) {
    return (
        <div className="grid grid-cols-1 items-start gap-6 @3xl:grid-cols-2">
            <Lead post={posts[0]} />
            {posts.length > 1 ? (
                <div className="flex flex-col gap-6">
                    {posts.slice(1, PER_PAGE).map((post) => <Row key={post.id} post={post} />)}
                </div>
            ) : null}
        </div>
    );
}

/**
 * Four articles with nothing in them, to draw a shape's outline. They carry a
 * date because a card keeps a line for one.
 */
const OUTLINE: Article[] = [1, 2, 3, 4].map((n) => ({ id: `outline-${n}`, number: n, slug: "", title: "", excerpt: "", content: "", coverImage: null, publishedAt: "2000-01-01T00:00:00.000Z", category: null }));

/**
 * The room a shape holds from its first paint, so the page under it does not
 * move when the articles arrive: the shape itself, drawn with empty articles
 * and hidden, in the same grid cell as whatever is shown. A picture is a
 * ratio of its box and a column folds at a width the theme decides, so no
 * single number is the height; the grid once held a fixed 786px, measured in
 * one theme's column, and stacked to 2056px in a narrower one. An outline of
 * the real thing is right at every width, and sharing a cell rather than
 * covering the outline lets a longer answer, one with pages, grow past it.
 * `a-section-keeps-the-room-it-reserves.spec.ts` asks the block its height
 * before and after.
 */
function Room({ outline, children }: { outline: ReactNode; children: ReactNode }) {
    return (
        <div className="grid">
            <div className="flex flex-col [grid-area:1/1]">{children}</div>
            {/* After what is shown, so the first lead or date a page or a
                theme looks for is a real one. */}
            <div aria-hidden="true" className="invisible [grid-area:1/1]">
                <OutlineContext.Provider value={true}>{outline}</OutlineContext.Provider>
            </div>
        </div>
    );
}

function Grid({ posts }: { posts: Article[] }) {
    const [page, setPage] = useState(1);
    const pages = Math.ceil(posts.length / PER_PAGE);
    return (
        <>
            <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-2">
                {posts.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((post) => <NewsCard key={post.id} post={post} />)}
            </div>
            <Pagination page={page} pages={pages} onPageChange={setPage} className="mt-2" />
        </>
    );
}

/**
 * `blog.news`: the site's news, as a grid of cards (`grid`, what the homepage
 * always drew) or led by the newest article (`featured`).
 *
 * The heading is drawn in every state, waiting and empty included, above the
 * content: the widget column beside this one is offset by exactly a heading,
 * and a heading inside the empty card left the first widget 52px below it.
 */
export function NewsBlock({ settings }: BlockProps) {
    const t = useTranslations("news");
    const blogT = useTranslations("blog");
    const commonT = useTranslations("common");
    const text = useBlockText();
    const [posts, setPosts] = useState<Article[] | null>(null);
    // A read that did not come back says so: it used to read as "no news
    // yet" (an-empty-screen-says-which-empty).
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const featured = settings.variant === "featured";

    useEffect(() => {
        let active = true;
        fetch(`/api/v1/blog/articles?limit=${featured ? PER_PAGE : PER_PAGE * 2}`)
            .then((res) => {
                if (!res.ok) throw new Error(`articles answered ${res.status}`);
                return res.json();
            })
            .then((data: { articles?: Article[] }) => { if (active) setPosts(data.articles ?? []); })
            .catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [featured, reloadKey]);

    const heading = (
        <BlockHeading
            kicker={text(settings.kicker) || undefined}
            title={text(settings.title) || t("title")}
            action={settings.allLink === true ? (
                <Link href="/blog" className="text-sm font-bold text-primary hover:underline">{blogT("allArticles")} ›</Link>
            ) : undefined}
        />
    );
    const outline = featured ? <Featured posts={OUTLINE} /> : <Grid posts={OUTLINE} />;
    const waiting = <Waiting label={commonT("loading")} />;
    const empty = (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
            <Newspaper className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
        </div>
    );

    if (failed || posts === null || posts.length === 0) {
        const retry = () => {
            setFailed(false);
            setPosts(null);
            setReloadKey((k) => k + 1);
        };
        const shown = failed ? <LoadFailed onRetry={retry} /> : posts === null ? waiting : empty;
        return (
            <div>
                {heading}
                <Room outline={outline}>{shown}</Room>
            </div>
        );
    }

    return (
        <div>
            {heading}
            <Room outline={outline}>{featured ? <Featured posts={posts} /> : <Grid posts={posts} />}</Room>
        </div>
    );
}

export default NewsBlock;
