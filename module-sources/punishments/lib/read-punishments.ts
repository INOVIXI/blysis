/**
 * One page of the record, read on the server.
 *
 * The page fetched it after it had loaded, so the HTML the server sent carried
 * no entry: measured, 117 characters of text inside `<main>`. The endpoint
 * calls this too, so a filter means the same thing on both - a type is a
 * filter on the state, not on the spelling the row happened to be written
 * with.
 */
import { prisma } from "@/core/sdk/server";
import { canonicalType, spellingsOf } from "./punishment-types";
import { isPunishmentStatus, punishmentStatus, statusWhere } from "./status";

export async function readPunishments(options: {
    type?: string | null;
    search?: string | null;
    status?: string | null;
    page?: number;
    perPage?: number;
}) {
    const now = new Date();
    const perPage = Math.max(1, options.perPage ?? 20);
    const page = Math.max(1, Math.floor(options.page ?? 1) || 1);

    const where: Record<string, unknown> = {};
    if (options.type) {
        const canonical = canonicalType(options.type);
        where.type = canonical ? { in: spellingsOf(canonical) } : options.type;
    }
    if (options.search) where.playerName = { contains: options.search, mode: "insensitive" };
    const status = options.status ?? null;
    if (isPunishmentStatus(status)) where.AND = [statusWhere(status, now)];

    const [punishments, total] = await Promise.all([
        prisma.punishment.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * perPage,
            take: perPage,
        }),
        prisma.punishment.count({ where }),
    ]);

    return {
        punishments: punishments.map((row) => ({ ...row, status: punishmentStatus(row, now.getTime()) })),
        total,
        page,
        pages: Math.max(1, Math.ceil(total / perPage)),
    };
}
