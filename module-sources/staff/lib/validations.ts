import { z } from "zod";

/** A staff member on the public team page. */
export const staffMemberSchema = z.object({
    name: z.string().trim().min(1, "Name and role required").max(100),
    role: z.string().trim().min(1, "Name and role required").max(100),
    avatar: z.string().max(2_000).optional().nullable(),
    userId: z.string().max(64).optional().nullable(),
    order: z.number().int().min(0).max(10_000).optional(),
});

/**
 * Whose translations a member's are, in core's table, and the field that has
 * them: the role title, held to its column's own limit. A name is a person's
 * and is not translated.
 */
export const STAFF_TEXT = { owner: "staff", entity: "member" };
export const TRANSLATED_FIELDS = { role: 100 };
