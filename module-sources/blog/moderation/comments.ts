import { prisma } from "@/core/sdk/server";
import type { ModerationItem, ModerationProvider, ModerationState } from "@/core/generated/module-moderation";

const INCLUDE = {
    author: { select: { id: true, username: true } },
    article: { select: { id: true, title: true, slug: true } },
} as const;

interface CommentRow {
    id: string;
    authorId: string | null;
    author: { id: string; username: string } | null;
    article: { id: string; title: string; slug: string | null } | null;
    content: string;
    moderationState: string;
    createdAt: Date;
}

const hrefOf = (r: CommentRow) => (r.article?.slug ? `/blog/${r.article.slug}` : undefined);

function toItem(r: CommentRow): ModerationItem {
    return { id: r.id, author: r.author, preview: r.content.slice(0, 200), title: r.article?.title, createdAt: r.createdAt, href: hrefOf(r) };
}

/** The queue lists by when a comment was written, the Rejected view by when it was last decided. */
async function listIn(state: ModerationState, skip: number, take: number) {
    const where = { moderationState: state };
    const [rows, total] = await Promise.all([
        prisma.blogComment.findMany({
            where,
            orderBy: state === "PENDING" ? { createdAt: "desc" } : { updatedAt: "desc" },
            skip,
            take,
            include: INCLUDE,
        }),
        prisma.blogComment.count({ where }),
    ]);
    return { total, items: rows.map(toItem) };
}

const provider: ModerationProvider = {
    async count() {
        return prisma.blogComment.count({ where: { moderationState: "PENDING" } });
    },

    list: (skip, take) => listIn("PENDING", skip, take),

    listRejected: (skip, take) => listIn("REJECTED", skip, take),

    async read(ids) {
        const rows = await prisma.blogComment.findMany({ where: { id: { in: ids } }, include: INCLUDE });
        return rows.map((r) => ({
            id: r.id,
            authorId: r.authorId,
            title: r.article?.title,
            body: r.content,
            state: r.moderationState as ModerationState,
            href: hrefOf(r),
        }));
    },

    async bulkUpdate(ids, newState) {
        const result = await prisma.blogComment.updateMany({
            where: { id: { in: ids } },
            data: { moderationState: newState },
        });
        return result.count;
    },
};

export default provider;
