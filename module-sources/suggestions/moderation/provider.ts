import { prisma } from "@/core/sdk/server";
import type { ModerationItem, ModerationProvider, ModerationState } from "@/core/generated/module-moderation";

const INCLUDE = { author: { select: { id: true, username: true } } } as const;

interface SuggestionRow {
    id: string;
    authorId: string | null;
    author: { id: string; username: string } | null;
    title: string;
    content: string;
    moderationState: string;
    createdAt: Date;
}

const hrefOf = (r: SuggestionRow) => `/suggestions/${r.id}`;

function toItem(r: SuggestionRow): ModerationItem {
    return { id: r.id, author: r.author, preview: r.content.slice(0, 200), title: r.title, createdAt: r.createdAt, href: hrefOf(r) };
}

/** The queue lists by when a suggestion was made, the Rejected view by when it was last decided. */
async function listIn(state: ModerationState, skip: number, take: number) {
    const where = { moderationState: state };
    const [rows, total] = await Promise.all([
        prisma.suggestion.findMany({
            where,
            orderBy: state === "PENDING" ? { createdAt: "desc" } : { updatedAt: "desc" },
            skip,
            take,
            include: INCLUDE,
        }),
        prisma.suggestion.count({ where }),
    ]);
    return { total, items: rows.map(toItem) };
}

const provider: ModerationProvider = {
    async count() {
        return prisma.suggestion.count({ where: { moderationState: "PENDING" } });
    },

    list: (skip, take) => listIn("PENDING", skip, take),

    listRejected: (skip, take) => listIn("REJECTED", skip, take),

    async read(ids) {
        const rows = await prisma.suggestion.findMany({ where: { id: { in: ids } }, include: INCLUDE });
        return rows.map((r) => ({
            id: r.id,
            authorId: r.authorId,
            title: r.title,
            body: r.content,
            state: r.moderationState as ModerationState,
            href: hrefOf(r),
        }));
    },

    async bulkUpdate(ids, newState) {
        const result = await prisma.suggestion.updateMany({
            where: { id: { in: ids } },
            data: { moderationState: newState },
        });
        return result.count;
    },
};

export default provider;
