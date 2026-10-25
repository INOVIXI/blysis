"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Newspaper } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { Badge, BlockHeading, LoadFailed, Pagination, Waiting, buttonClassName, useBlockText, useLocalDate, type BlockProps } from "@/core/sdk/ui";
import { NewsCard, type BlogCardArticle } from "./news-card";
import { readingMinutes } from "../lib/reading-time";

interface Article extends BlogCardArticle {
    content?: string | null;
}

/** Cards a grid page holds, and articles the featured shape shows. */
const PER_PAGE = 4;

/**
 * Room each shape holds from its first paint, so the page under it does not
 * move when the articles arrive. The grid is a heading over two rows of
 * cards, measured at 786px in the homepage's wide column; the featured shape
 * is as tall as its lead card, whose picture is a ratio and whose text is a
 * fixed number of lines. `a-section-keeps-the-room-it-reserves.spec.ts` asks
 * the block its height before and after.
 */
const GRID_ROOM = "min-h-[786px]";

function href(post: Article) {
    return `/blog/${post.number}/${post.slug}`;
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
                <h3 className="line-clamp-2 min-h-[3.5rem] text-xl font-bold leading-7 text-foreground">
                    <Link href={href(post)} className="hover:text-primary">{post.title}</Link>
                </h3>
                <p className="line-clamp-3 min-h-[4.5rem] text-sm leading-6 text-muted-foreground">{post.excerpt}</p>
                <Link href={href(post)} className={`${buttonClassName("secondary", "default")} mt-auto self-start`}>{t("readMore")}</Link>
            </div>
        </article>
    );
}

/** One of the articles after the newest: a small picture, category, headline, date. */
function Row({ post }: { post: Article }) {
    const formatDate = useLocalDate({ dateStyle: "long" });
    const date = post.publishedAt || post.createdAt;
    return (
        <article data-news-row className="flex min-h-[7.5rem] overflow-hidden rounded-xl border border-border bg-card">
            <div className="relative w-[7.5rem] shrink-0 bg-muted">
                <Picture post={post} sizes="120px" />
            </div>
            <div className="flex min-w-0 flex-col justify-center gap-1.5 px-4 py-3">
                {post.category ? <Badge tone="info" solid className="self-start">{post.category.name}</Badge> : null}
                <h3 className="line-clamp-2 font-bold leading-6 text-foreground">
                    <Link href={href(post)} className="hover:text-primary">{post.title}</Link>
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

/** Four articles with nothing in them, to draw the featured shape's outline. */
const OUTLINE: Article[] = [1, 2, 3, 4].map((n) => ({ id: `outline-${n}`, number: n, slug: "", title: "", excerpt: "", content: "", coverImage: null, publishedAt: null, category: null }));

/**
 * The featured shape's room while there is nothing to put in it: the shape
 * itself, drawn with empty articles and hidden, under whatever is shown
 * instead. The picture is a ratio of the box, so no single number is its
 * height; an outline of the real thing is right at every width.
 */
function FeaturedRoom({ children }: { children: ReactNode }) {
    return (
        <div className="relative">
            <div aria-hidden="true" className="invisible"><Featured posts={OUTLINE} /></div>
            <div className="absolute inset-0 flex flex-col">{children}</div>
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
        return featured ? (
            <div>
                {heading}
                <FeaturedRoom>{shown}</FeaturedRoom>
            </div>
        ) : (
            <div className={`${GRID_ROOM} flex flex-col`}>
                {heading}
                {shown}
            </div>
        );
    }

    return (
        <div className={featured ? undefined : GRID_ROOM}>
            {heading}
            {featured ? <Featured posts={posts} /> : <Grid posts={posts} />}
        </div>
    );
}

export default NewsBlock;
