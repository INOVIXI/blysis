/**
 * Answers `support.knowledge` with the help articles that share words with a
 * ticket, in the member's language where the article has a translation, for
 * a support assistant to draw on and point the member to.
 *
 * The shapes are stated here rather than taken from the hook's declaration:
 * the module that asks declares them, and a site that installs this one
 * without it still builds this file (forum's `leaderboard-board.ts` says the
 * same). With both installed, `npm run typecheck:modules` holds these
 * against the declared contract.
 */
import { prisma, textContains, translateContent } from "@/core/sdk/server";
import { HELP_ARTICLE_TEXT } from "../lib/validations";

export const SOURCE_ID = "help-center.articles";

interface KnowledgePiece {
    source: string;
    title: string;
    text: string;
    href?: string;
}

interface KnowledgeQuestion {
    terms: string[];
    locale: string;
    limit: number;
    sources: string[];
}

/** How much of one article an assistant is handed. */
const TEXT_MAX = 2000;
/** How many candidates are ranked before the best are kept. */
const CANDIDATES = 50;

const helpArticles = async (current: KnowledgePiece[], context: KnowledgeQuestion): Promise<KnowledgePiece[]> => {
    if (!context.sources.includes(SOURCE_ID) || context.terms.length === 0 || context.limit <= 0) return current;
    // Only what a visitor can read: an article taken down is not an answer.
    const rows = await prisma.helpArticle.findMany({
        where: { isActive: true, OR: context.terms.flatMap((term) => textContains(["title", "content"], term)) },
        select: { id: true, slug: true, title: true, content: true },
        take: CANDIDATES,
    });
    // Most shared words first, ranked on the original the words matched.
    const hits = (row: { title: string; content: string }) => {
        const text = `${row.title} ${row.content}`.toLowerCase();
        return context.terms.filter((term) => text.includes(term.toLowerCase())).length;
    };
    const best = rows
        .map((row) => ({ row, hits: hits(row) }))
        .sort((a, b) => b.hits - a.hits)
        .slice(0, context.limit)
        .map(({ row }) => row);
    const read = await translateContent(prisma, HELP_ARTICLE_TEXT, best, ["title", "content"], context.locale);
    return [
        ...current,
        ...read.map((row) => ({ source: SOURCE_ID, title: row.title, text: row.content.slice(0, TEXT_MAX), href: `/help/${row.slug}` })),
    ];
};

export default helpArticles;
