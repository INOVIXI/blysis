
"use client";
import { NewsCard } from "./news-card";

interface BlogPost {
    id: string;
    number: number;
    title: string;
    slug: string;
    excerpt: string | null;
    coverImage: string | null;
    publishedAt: string | Date | null;
    createdAt: string | Date;
    category: { name: string; slug: string } | null;
}

interface NewsGridProps {
    posts: BlogPost[];
}

export function NewsGrid({ posts }: NewsGridProps) {
    // Default 2-column grid
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {posts.map((post) => (
                <NewsCard key={post.id} post={post} />
            ))}
        </div>
    );
}
