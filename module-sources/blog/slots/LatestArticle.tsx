"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/core/sdk/navigation";
import { Badge, useLocalDate } from "@/core/sdk/ui";
import type { BlogCardArticle } from "../components/news-card";
import { readingMinutes } from "../lib/reading-time";

interface Article extends BlogCardArticle {
    content?: string | null;
}

/**
 * Beside the sign-in form, in a theme's `auth.login.aside`: the newest
 * article, so someone coming back sees what changed while they were away.
 *
 * Nothing is drawn while it is on its way, when nothing is published or when
 * the read failed: it sits beside a form, not in place of one.
 */
export default function LatestArticle() {
    const t = useTranslations("news");
    const formatDate = useLocalDate({ dateStyle: "long" });
    const [post, setPost] = useState<Article | null>(null);

    useEffect(() => {
        let active = true;
        fetch("/api/v1/blog/articles?limit=1")
            .then((res) => {
                if (!res.ok) throw new Error(`articles answered ${res.status}`);
                return res.json();
            })
            .then((data: { articles?: Article[] }) => { if (active) setPost(data.articles?.[0] ?? null); })
            .catch(() => {});
        return () => { active = false; };
    }, []);

    if (!post) return null;
    const href = `/blog/${post.number}/${post.slug}`;
    const date = post.publishedAt || post.createdAt;
    return (
        <article data-latest-article className="flex flex-col gap-3 rounded-xl bg-card p-5 text-card-foreground">
            <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
                {post.category ? <Badge tone="info" solid>{post.category.name}</Badge> : null}
                <span>
                    {date ? `${formatDate(date)} · ` : null}
                    {t("readingTime", { minutes: readingMinutes(post.content) })}
                </span>
            </p>
            <h2 className="text-xl font-bold leading-7">
                <Link href={href} className="hover:text-primary">{post.title}</Link>
            </h2>
            {post.excerpt ? <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{post.excerpt}</p> : null}
            <Link href={href} className="self-start text-sm font-bold text-primary hover:underline">{t("readMore")} ›</Link>
        </article>
    );
}
