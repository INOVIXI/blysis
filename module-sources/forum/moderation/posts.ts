import { prisma } from "@/core/sdk/server";
import type { ModerationItem, ModerationProvider, ModerationState } from "@/core/generated/module-moderation";

const INCLUDE = {
    author: { select: { id: true, username: true } },
    topic: { select: { id: true, title: true, slug: true } },
} as const;

interface PostRow {
    id: string;
    authorId: string | null;
    author: { id: string; username: string } | null;
    topic: { id: string; title: string; slug: string | null } | null;
    content: string;
    moderationState: string;
    createdAt: Date;
}

const hrefOf = (r: PostRow) => (r.topic ? `/forum/topic/${r.topic.slug || r.topic.id}` : undefined);

function toItem(r: PostRow): ModerationItem {
    return { id: r.id, author: r.author, preview: r.content.slice(0, 200), title: r.topic?.title, createdAt: r.createdAt, href: hrefOf(r) };
}

/** The queue lists by when a reply was written, the Rejected view by when it was last decided. */
async function listIn(state: ModerationState, skip: number, take: number) {
    const where = { moderationState: state };
    const [rows, total] = await Promise.all([
        prisma.forumPost.findMany({
            where,
            orderBy: state === "PENDING" ? { createdAt: "desc" } : { updatedAt: "desc" },
            skip,
            take,
            include: INCLUDE,
        }),
        prisma.forumPost.count({ where }),
    ]);
    return { total, items: rows.map(toItem) };
}

const provider: ModerationProvider = {
    async count() {
        return prisma.forumPost.count({ where: { moderationState: "PENDING" } });
    },

    list: (skip, take) => listIn("PENDING", skip, take),

    listRejected: (skip, take) => listIn("REJECTED", skip, take),

    async read(ids) {
        const rows = await prisma.forumPost.findMany({ where: { id: { in: ids } }, include: INCLUDE });
        return rows.map((r) => ({
            id: r.id,
            authorId: r.authorId,
            title: r.topic?.title,
            body: r.content,
            state: r.moderationState as ModerationState,
            href: hrefOf(r),
        }));
    },

    async bulkUpdate(ids, newState) {
        const result = await prisma.forumPost.updateMany({
            where: { id: { in: ids } },
            data: { moderationState: newState },
        });
        return result.count;
    },
};

export default provider;
