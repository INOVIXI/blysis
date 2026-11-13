/**
 * An in-memory table of things a moderation provider holds: enough of a
 * Prisma delegate (`findMany`, `count`, `updateMany`) for the provider tests
 * in `tests/modules/*`, with each row's relations already attached the way
 * an `include` would return them.
 */
export interface ModeratedRow {
    id: string;
    authorId: string | null;
    content: string;
    moderationState: string;
    createdAt: Date;
    updatedAt: Date;
    [relation: string]: unknown;
}

interface Where {
    moderationState?: string;
    id?: { in: string[] };
}

function matches(row: ModeratedRow, where: Where | undefined): boolean {
    if (!where) return true;
    if (where.moderationState !== undefined && row.moderationState !== where.moderationState) return false;
    if (where.id && !where.id.in.includes(row.id)) return false;
    return true;
}

export function moderatedTable(rows: ModeratedRow[]) {
    return {
        rows,
        async findMany(args: { where?: Where; orderBy?: Record<string, "asc" | "desc">; skip?: number; take?: number }) {
            const [[field, direction]] = Object.entries(args.orderBy ?? { createdAt: "desc" });
            const sorted = rows
                .filter((row) => matches(row, args.where))
                .sort((a, b) => {
                    const diff = (a[field] as Date).getTime() - (b[field] as Date).getTime();
                    return direction === "desc" ? -diff : diff;
                });
            const start = args.skip ?? 0;
            return sorted.slice(start, args.take === undefined ? undefined : start + args.take).map((row) => ({ ...row }));
        },
        async count(args: { where?: Where } = {}) {
            return rows.filter((row) => matches(row, args.where)).length;
        },
        async updateMany(args: { where: Where; data: { moderationState: string } }) {
            const hit = rows.filter((row) => matches(row, args.where));
            for (const row of hit) row.moderationState = args.data.moderationState;
            return { count: hit.length };
        },
    };
}
