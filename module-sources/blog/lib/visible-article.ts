/**
 * The article filter every public door applies.
 *
 * Six reads spelled it for themselves and they did not agree. The API list,
 * the search provider and the sitemap tested three things; the article's own
 * page, the blog listing and the route resolver tested two, leaving out the
 * `publishAt` check - so the door that shows the whole article was the loosest
 * of them. The sitemap's own comment even said the page applied that test,
 * which had stopped being true.
 *
 * Two more doors never spelled it at all: creating a comment looked the
 * article up by id and checked only that a row came back, and listing comments
 * narrowed on the comment's own moderation state and never on the article's.
 *
 * A stranger does not guess a cuid, so the way in is an article that was
 * published and then pulled back to a draft: its id and slug were public while
 * it was up, and afterwards the page said it was gone while the comment
 * endpoints went on serving and accepting.
 *
 * One definition, so the next door added is one import rather than one more
 * chance to spell it differently. `new Date()` is evaluated per call because a
 * scheduled article becomes visible with the clock, not with the process.
 */
export function publishedArticle(): {
    status: "PUBLISHED";
    publishedAt: { lte: Date };
    OR: [{ publishAt: null }, { publishAt: { lte: Date } }];
} {
    const now = new Date();
    return {
        status: "PUBLISHED",
        publishedAt: { lte: now },
        // `publishAt` survives a status change that does not mention it, so a
        // scheduled article flipped to PUBLISHED by hand keeps a future date
        // here. The API list, the search provider and the sitemap all tested
        // it; the article's own page, the blog listing and the route resolver
        // did not, so the one door that shows the whole article was the
        // loosest of the six.
        OR: [{ publishAt: null }, { publishAt: { lte: now } }],
    };
}

/**
 * The same question as `publishedArticle()`, asked of a row already read.
 *
 * The article endpoint finds its row by id, slug or number and then decides
 * who may see it, because an editor reads a draft through the same door. Two
 * spellings of one rule, side by side, so a change to one is seen in the other.
 */
export function isPublishedArticle(
    article: { status: string; publishedAt: Date | null; publishAt: Date | null },
    now: Date = new Date(),
): boolean {
    return article.status === "PUBLISHED"
        && article.publishedAt !== null && article.publishedAt <= now
        && (article.publishAt === null || article.publishAt <= now);
}
