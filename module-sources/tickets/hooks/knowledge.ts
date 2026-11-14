/**
 * Answers `support.knowledge` with the canned responses that share words with
 * a ticket, for a support assistant to draw on.
 *
 * The shapes are stated here rather than taken from the hook's declaration:
 * the module that asks declares them, and a site that installs this one
 * without it still builds this file (forum's `leaderboard-board.ts` says the
 * same). With both installed, `npm run typecheck:modules` holds these
 * against the declared contract.
 */
import { prisma, textContains } from "@/core/sdk/server";

export const SOURCE_ID = "tickets.canned";

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

/** How much of one canned response an assistant is handed. */
const TEXT_MAX = 2000;
/** How many candidates are ranked before the best are kept. */
const CANDIDATES = 50;

const cannedResponses = async (current: KnowledgePiece[], context: KnowledgeQuestion): Promise<KnowledgePiece[]> => {
    if (!context.sources.includes(SOURCE_ID) || context.terms.length === 0 || context.limit <= 0) return current;
    const rows = await prisma.cannedResponse.findMany({
        where: { OR: context.terms.flatMap((term) => textContains(["title", "content"], term)) },
        select: { title: true, content: true },
        take: CANDIDATES,
    });
    // Most shared words first: any one word matching is how a row got here,
    // and a response that shares five is likelier to be the answer than one
    // that shares a single common word.
    const hits = (row: { title: string; content: string }) => {
        const text = `${row.title} ${row.content}`.toLowerCase();
        return context.terms.filter((term) => text.includes(term.toLowerCase())).length;
    };
    const best = rows
        .map((row) => ({ row, hits: hits(row) }))
        .sort((a, b) => b.hits - a.hits)
        .slice(0, context.limit)
        .map(({ row }) => ({ source: SOURCE_ID, title: row.title, text: row.content.slice(0, TEXT_MAX) }));
    return [...current, ...best];
};

export default cannedResponses;
