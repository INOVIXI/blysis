import { prisma } from "@/core/sdk/server";
import type { ModerationItem, ModerationProvider, ModerationState } from "@/core/generated/module-moderation";

/**
 * The replies waiting for a moderator.
 *
 * Held behind the board's own switch: an operator who reviews suggestions has
 * not asked to let the replies under them through unread.
 */

const INCLUDE = {
    author: { select: { id: true, username: true } },
    suggestion: { select: { id: true, title: true } },
} as const;

interface CommentRow {
    id: string;
    authorId: string | null;
    author: { id: string; username: string } | null;
    suggestion: { id: string; title: string };
    content: string;
    moderationState: string;
    createdAt: Date;
}

const hrefOf = (r: CommentRow) => `/suggestions/${r.suggestion.id}`;

function toItem(r: CommentRow): ModerationItem {
    return { id: r.id, author: r.author, preview: r.content.slice(0, 200), title: r.suggestion.title, createdAt: r.createdAt, href: hrefOf(r) };
}

/** The queue lists by when a reply was written, the Rejected view by when it was last decided. */
async function listIn(state: ModerationState, skip: number, take: number) {
    const where = { moderationState: state };
    const [rows, total] = await Promise.all([
        prisma.suggestionComment.findMany({
            where,
            orderBy: state === "PENDING" ? { createdAt: "desc" } : { updatedAt: "desc" },
            skip,
            take,
            include: INCLUDE,
        }),
        prisma.suggestionComment.count({ where }),
    ]);
    return { total, items: rows.map(toItem) };
}

const provider: ModerationProvider = {
    async count() {
        return prisma.suggestionComment.count({ where: { moderationState: "PENDING" } });
    },

    list: (skip, take) => listIn("PENDING", skip, take),

    listRejected: (skip, take) => listIn("REJECTED", skip, take),

    async read(ids) {
        const rows = await prisma.suggestionComment.findMany({ where: { id: { in: ids } }, include: INCLUDE });
        return rows.map((r) => ({
            id: r.id,
            authorId: r.authorId,
            title: r.suggestion.title,
            body: r.content,
            state: r.moderationState as ModerationState,
            href: hrefOf(r),
        }));
    },

    async bulkUpdate(ids, newState) {
        const result = await prisma.suggestionComment.updateMany({
            where: { id: { in: ids } },
            data: { moderationState: newState },
        });
        return result.count;
    },
};

export default provider;
