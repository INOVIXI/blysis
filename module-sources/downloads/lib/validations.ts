import { z } from "zod";

/**
 * A download entry. Every field here was written to the row untyped: a
 * `fileUrl` could be any string of any length, and `fileSize` reached an
 * `Int` column as whatever JSON carried.
 */
/**
 * Whose translations these are, in core's table, and the fields that have
 * them: each language held to its column's own limit. The file, its name and
 * the picture are the same in every language.
 */
export const DOWNLOAD_TEXT = { owner: "downloads", entity: "download" };
export const TRANSLATED_FIELDS = { title: 200, description: 2_000, details: 50_000 };

export const downloadCreateSchema = z.object({
    title: z.string().trim().min(1, "Title, fileName and fileUrl required").max(200),
    description: z.string().max(2_000).optional().nullable(),
    fileName: z.string().trim().min(1, "Title, fileName and fileUrl required").max(255),
    fileUrl: z.string().trim().min(1, "Title, fileName and fileUrl required").max(2_000),
    fileSize: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional().nullable(),
    // A page's worth rather than a line's. Still bounded: it is written by an
    // admin, stored as HTML and rendered to every visitor.
    details: z.string().max(50_000).optional().nullable(),
    coverImage: z.string().max(500).optional().nullable(),
});
