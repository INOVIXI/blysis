import { z } from "zod";

/**
 * A vote site, and a claim against one.
 *
 * `voteSiteId` reached a Prisma `where` clause untyped, where an object is a
 * filter operator rather than an id; `order` reaches an `Int` column, so a
 * string or a fraction was a 500 rather than a 400.
 */
export const voteClaimSchema = z.object({
    voteSiteId: z.string().trim().min(1, "Vote site ID required").max(64),
});

export const voteSiteCreateSchema = z.object({
    name: z.string().trim().min(1, "Name and URL required").max(100),
    url: z.string().trim().min(1, "Name and URL required").max(2_000),
    icon: z.string().max(2_000).optional().nullable(),
    order: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
});

export const voteSiteUpdateSchema = voteSiteCreateSchema.partial();

/**
 * Whose translations a vote site's are, in core's table, and the field that
 * has them: each language held to its column's own limit. The address is a
 * place, not prose, and has none.
 */
export const VOTE_SITE_TEXT = { owner: "vote", entity: "site" };
export const TRANSLATED_FIELDS = { name: 100 };
