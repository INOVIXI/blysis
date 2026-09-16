/**
 * A help article, written by the server.
 *
 * The screen below stays a client component because the reader votes on it,
 * but it used to fetch the article on mount, so no article ever reached the
 * HTML the server sent. All 30 the sitemap publishes were empty pages to a
 * reader without JavaScript and to anything that indexes one.
 *
 * What may be shown - the view count is a setting - is decided in
 * `readArticle`, which the endpoint calls too, so a count the site hides is
 * hidden on both.
 */
import { notFound } from "next/navigation";
import { countArticleView, readArticle } from "../../../../lib/read-article";
import { ArticleView } from "../../../../components/ArticleView";

interface PageProps {
    params: Promise<{ slug: string }>;
}

export default async function HelpArticlePage({ params }: PageProps) {
    const { slug } = await params;
    const read = await readArticle(slug);
    if (!read) notFound();

    await countArticleView(read.article.id);

    return <ArticleView slug={slug} article={read.article} neighbours={read.neighbours} />;
}
