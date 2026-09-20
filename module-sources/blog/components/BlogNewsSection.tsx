"use client";

import { useState, useEffect } from "react";
import { NewsCard } from "./news-card";
import { Pagination, Waiting } from "@/core/sdk/ui";
import { useLocalDate } from "@/core/sdk/ui";
import { Newspaper } from "lucide-react";
import { useTranslations } from "next-intl";

interface BlogPost {
  id: string;
  number: number;
  title: string;
  slug: string;
  excerpt: string | null;
  coverImage: string | null;
  publishedAt: string | null;
  createdAt: string;
  category: { name: string; slug: string } | null;
}

/**
 * Room the news section holds from its first paint: a heading over two rows
 * of cards, measured at 786px on a 1280px viewport. Every state below renders
 * that same shape, so the number is what the section already is rather than a
 * guess about it.
 *
 * It is only a number worth writing down because `NewsCard` reserves its own
 * text: a card that grew with its headline made this section 757px for one
 * set of articles and 801px for another, and no single reservation can be
 * right for both. Measure it again if that card changes;
 * `a-section-keeps-the-room-it-reserves.spec.ts` is what says so.
 */
const NEWS_SECTION_HEIGHT = "min-h-[786px]";

export function BlogNewsSection() {
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [blogPosts, setBlogPosts] = useState<BlogPost[]>([]);
  const t = useTranslations('news');
  const commonT = useTranslations('common');
    const formatLocalDate = useLocalDate();

  useEffect(() => {
    fetch('/api/v1/blog/articles?limit=8')
      .then(res => res.json())
      .then(data => { setBlogPosts(data.articles || []); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  }, []);

  // Two pages out of the eight articles fetched above. This read the
  // `per_page_home_news` setting, which no manifest declares and no screen
  // writes, so the fallback was the only value it ever had.
  const newsPerPage = 4;
  const totalPages = Math.ceil(blogPosts.length / newsPerPage);
  const paginatedNews = blogPosts.slice((currentPage - 1) * newsPerPage, currentPage * newsPerPage);

  // The section keeps its height while it waits, heading included. Leaving
  // the area to size itself left it 52px short of the article state and 48px
  // over the empty one, so whichever answer came back moved the footer and
  // everything under it. The heading needs no data, so it is drawn from the
  // first paint.
  if (isLoading) {
    return (
      <div className={NEWS_SECTION_HEIGHT}>
        <h2 className="text-xl font-bold text-foreground mb-6">{t('title')}</h2>
        <Waiting label={commonT("loading")} />
      </div>
    );
  }
  // Don't return null when empty - render a visible empty state so the
  // homepage doesn't appear blank when blog is the only enabled section
  // and there's no published content yet.
  if (blogPosts.length === 0) {
    return (
      <div className={`${NEWS_SECTION_HEIGHT} flex flex-col items-center justify-center bg-card border border-dashed border-border rounded-lg py-10 px-6 text-center`}>
        <Newspaper className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
        <h2 className="font-medium text-foreground">{t('title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t('empty')}</p>
      </div>
    );
  }

  return (
    <div className={NEWS_SECTION_HEIGHT}>
      <h2 className="text-xl font-bold text-foreground mb-6">{t('title')}</h2>
      <div className="grid md:grid-cols-2 gap-6">
        {paginatedNews.map((post) => (
          <NewsCard key={post.id} post={post} />
        ))}
      </div>
      <Pagination page={currentPage} pages={totalPages} onPageChange={setCurrentPage} className="mt-2" />
    </div>
  );
}

export default BlogNewsSection;
