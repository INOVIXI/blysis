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
 * That was also done to the text, by giving the headline two lines of room
 * and the excerpt two more whether or not they filled them - and a one-line
 * headline then had a finger's width of nothing under it before its excerpt
 * began. The cards were even and every one of them had a hole in it. The row
 * is a grid, and a grid already stretches its cells to the tallest; the card
 * only has to be a full-height column so its own border reaches the bottom.
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
            <div className="flex flex-1 flex-col gap-1.5 p-4">
                <h3 className="line-clamp-2 font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
                    {post.title}
                </h3>
                {post.excerpt && (
                    <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{post.excerpt}</p>
                )}
                {/* The date sits on the floor of the card, so the dates in a
                    row line up however long the headlines above them are. */}
                {date && (
                    <p className="mt-auto pt-3 text-xs text-muted-foreground">{formatLocalDate(date)}</p>
                )}
            </div>
        </Link>
    );
}
