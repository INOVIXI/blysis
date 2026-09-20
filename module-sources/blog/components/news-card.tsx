"use client";

import { Link } from "@/core/sdk/navigation";
import Image from "next/image";
import { Newspaper } from "lucide-react";
import { Badge, useLocalDate } from "@/core/sdk/ui";

/**
 * One article, drawn the same way wherever it appears.
 *
 * The homepage section and the blog index each had their own card, and the one
 * on the index was wrong twice: it read the picture from `post.image` when an
 * article carries `coverImage`, so the field was always undefined and every
 * card on the index was a bare box - a bug that looks exactly like a site
 * whose authors have not uploaded anything. And it linked to `/blog/<slug>`
 * while every other link in this module is `/blog/<number>/<slug>`.
 *
 * The picture keeps its space when there is none, so two cards side by side
 * are not different heights depending on who remembered to upload a cover.
 *
 * The text keeps its space too, and it took two goes to keep it in the right
 * place. Reserving two lines for the headline and two for the excerpt
 * separately left a one-line headline with a finger's width of nothing under
 * it before its excerpt began: the cards were even and every one of them had
 * a hole in it. Dropping the reservation altogether fixed the hole and moved
 * the problem: the card was then as tall as whatever an author had typed, so
 * the homepage section holding two rows of these was a different height for
 * every set of articles. It reserves 720px before the articles arrive and
 * rendered 757px with ordinary headlines and 801px with long ones, which is
 * the footer moving under a reader on every load.
 *
 * So the reservation is on the pair rather than on each of them: four line
 * boxes, filled from the top, with whatever is left over collecting under the
 * excerpt where the date already holds the floor. The leading is pinned for
 * the same reason - a reservation counted in line boxes has to know how tall
 * one is - and `a-section-keeps-the-room-it-reserves.spec.ts` asks the
 * section its height with three different sets of articles.
 *
 * Where a cover is missing the box is quiet rather than captioned. "No image"
 * is a note to whoever uploads, printed on the page for everybody who reads.
 */
export interface BlogCardArticle {
    id: string;
    number: number;
    title: string;
    slug: string;
    excerpt?: string | null;
    coverImage?: string | null;
    publishedAt?: Date | string | null;
    createdAt?: Date | string;
    category?: { name: string; slug: string } | null;
}

export function NewsCard({ post }: { post: BlogCardArticle }) {
    const formatLocalDate = useLocalDate();
    const date = post.publishedAt || post.createdAt;

    return (
        <Link
            href={`/blog/${post.number}/${post.slug}`}
            className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/40"
        >
            <div className="relative aspect-card overflow-hidden bg-muted">
                {post.coverImage ? (
                    <Image
                        src={post.coverImage}
                        alt=""
                        fill
                        sizes="(max-width: 768px) 100vw, 33vw"
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center">
                        <Newspaper className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
                    </div>
                )}
                {post.category && (
                    <Badge tone="info" solid className="absolute left-3 top-3">{post.category.name}</Badge>
                )}
            </div>
            <div className="flex flex-1 flex-col p-4">
                {/* Two lines of headline over two of summary: 3rem and 2.5rem
                    of line boxes with 0.375rem between them. */}
                <div className="flex min-h-[5.875rem] flex-col gap-1.5">
                    <h3 className="line-clamp-2 font-semibold leading-6 text-foreground transition-colors group-hover:text-primary">
                        {post.title}
                    </h3>
                    {post.excerpt && (
                        <p className="line-clamp-2 text-sm leading-5 text-muted-foreground">{post.excerpt}</p>
                    )}
                </div>
                {/* The date sits on the floor of the card, so the dates in a
                    row line up however long the headlines above them are. */}
                {date && (
                    <p className="mt-auto pt-3 text-xs text-muted-foreground">{formatLocalDate(date)}</p>
                )}
            </div>
        </Link>
    );
}
