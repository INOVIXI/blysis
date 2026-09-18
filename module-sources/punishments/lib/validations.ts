import { z } from "zod";

/**
 * A punishment record.
 *
 * This endpoint takes an API key as well as an admin session, so its body
 * arrives from a game server plugin rather than only from a form of this
 * platform's own. Nothing here was typed: `playerName` reached a Prisma
 * `where: { username }` lookup, where an object is a filter operator rather
 * than a name, and `expiresAt` reached `new Date(...)` as whatever JSON
 * carried.
 */
export const punishmentCreateSchema = z.object({
    playerName: z.string().trim().min(1, "playerName and type required").max(64),
    playerUuid: z.string().max(64).optional().nullable(),
    type: z.string().trim().min(1, "playerName and type required").max(32),
    reason: z.string().max(1_000).optional().nullable(),
    duration: z.string().max(64).optional().nullable(),
    punishedBy: z.string().max(64).optional().nullable(),
    expiresAt: z.iso.datetime({ offset: true }).optional().nullable(),
});

/** What an admin may change afterwards: the reason, the clock, or revoke it. */
export const punishmentUpdateSchema = z.object({
    reason: z.string().max(1_000).optional().nullable(),
    active: z.boolean().optional(),
    duration: z.string().max(64).optional().nullable(),
    expiresAt: z.iso.datetime({ offset: true }).optional().nullable(),
    /** Why it was lifted. Read only when `active` is being set to false. */
    liftReason: z.string().max(500).optional().nullable(),
});
