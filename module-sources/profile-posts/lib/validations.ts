import { z } from "zod";

/**
 * What a wall accepts.
 *
 * The ceiling is the operator's (`maxLength`), so the schema takes the widest
 * the setting may be and the route checks the site's own figure against it.
 * Validating twice against two numbers is how a setting ends up meaning
 * nothing.
 */
export const HARD_LIMIT = 5000;

export const profilePostSchema = z.object({
    /** Whose wall. The author is the session, never the request. */
    profileUserId: z.string().min(1).max(64),
    body: z.string().min(1).max(HARD_LIMIT),
});

export const profileReplySchema = z.object({
    body: z.string().min(1).max(HARD_LIMIT),
});

/** Whether a member lets anyone write on their profile. */
export const wallSettingSchema = z.object({
    open: z.boolean(),
});
