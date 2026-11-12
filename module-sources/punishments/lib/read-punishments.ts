/**
 * One page of the record, read on the server.
 *
 * The page fetched it after it had loaded, so the HTML the server sent carried
 * no entry: measured, 117 characters of text inside `<main>`. The endpoint
 * calls this too, so a filter means the same thing on both - a type is a
 * filter on the state, not on the spelling the row happened to be written
 * with.
 */
import { prisma, translateContent } from "@/core/sdk/server";
import { canonicalType, spellingsOf } from "./punishment-types";
import { isPunishmentStatus, punishmentStatus, statusWhere } from "./status";
import { SCOPE_TEXT } from "./validations";

export async function readPunishments(options: {
    type?: string | null;
    search?: string | null;
    status?: string | null;
    /** A scope id, so a reader can look at one server or game mode at a time. */
    scope?: string | null;
    page?: number;
    perPage?: number;
    /** The reader's language, for the scopes' names; none reads the originals. */
    locale?: string;
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
    // An id rather than a name: a name is the operator's and can be edited
    // while somebody is reading the page it was filtered by.
    if (options.scope) where.scopeId = options.scope;
    const status = options.status ?? null;
    if (isPunishmentStatus(status)) where.AND = [statusWhere(status, now)];

    const [rows, total, offered] = await Promise.all([
        prisma.punishment.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * perPage,
            take: perPage,
            // The name only. `matchKey` is the other system's word for the
            // place and never reaches a reader.
            include: { scope: { select: { id: true, name: true } } },
        }),
        prisma.punishment.count({ where }),
        // What a reader may filter by, so the page draws the tabs the site
        // actually has rather than every scope ever made.
        prisma.punishmentScope.findMany({
            where: { isActive: true, punishments: { some: {} } },
            orderBy: [{ order: "asc" }, { name: "asc" }],
            select: { id: true, name: true },
            take: 30,
        }),
    ]);

    // Every scope the page names, the tabs and the entries', in one query.
    const named = new Map<string, { id: string; name: string }>();
    for (const scope of [...offered, ...rows.flatMap((row) => (row.scope ? [row.scope] : []))]) named.set(scope.id, scope);
    const translated = await translateContent(prisma, SCOPE_TEXT, [...named.values()], ["name"], options.locale ?? "");
    const nameOf = new Map(translated.map((scope) => [scope.id, scope.name]));
    const inLanguage = (scope: { id: string; name: string }) => ({ ...scope, name: nameOf.get(scope.id) ?? scope.name });

    return {
        punishments: rows.map((row) => ({
            ...row,
            scope: row.scope ? inLanguage(row.scope) : null,
            status: punishmentStatus(row, now.getTime()),
        })),
        scopes: offered.map(inLanguage),
        total,
        page,
        pages: Math.max(1, Math.ceil(total / perPage)),
    };
}
