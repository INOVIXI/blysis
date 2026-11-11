import { z } from "zod";

/**
 * What an announcement may be.
 *
 * Every field here used to arrive untyped: `title` and `content` were written
 * to the row with no ceiling, `startsAt` reached `new Date(...)` as whatever
 * JSON carried (an Invalid Date that Prisma rejects with a 500 rather than a
 * 400), and `includePages` could be an object where a string was meant.
 */
const isoDate = z.iso.datetime({ offset: true });

export const announcementCreateSchema = z.object({
    title: z.string().trim().min(1, "Title and content required").max(200),
    content: z.string().min(1, "Title and content required").max(10_000),
    type: z.enum(["info", "success", "warning", "error"]).optional(),
    isActive: z.boolean().optional(),
    dismissible: z.boolean().optional(),
    /** Comma-separated URL patterns; the banner matches against them. */
    includePages: z.string().max(2_000).optional().nullable(),
    excludePages: z.string().max(2_000).optional().nullable(),
    startsAt: isoDate.optional().nullable(),
    endsAt: isoDate.optional().nullable(),
    publishAt: isoDate.optional().nullable(),
});

/**
 * Whose translations these are, in core's table, and the fields that have
 * them: each language held to its column's own limit.
 */
export const ANNOUNCEMENT_TEXT = { owner: "announcements", entity: "announcement" };
export const TRANSLATED_FIELDS = { title: 200, content: 10_000 };

/** The same fields, all optional: a PATCH writes only what it names. */
export const announcementUpdateSchema = announcementCreateSchema.partial();
