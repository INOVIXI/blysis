import { z } from "zod";

// ==================== FORUM SCHEMAS ====================

export const forumCategorySchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    slug: z.string().min(1).max(200).optional(),
    description: z.string().max(500).optional().nullable(),
    icon: z.string().max(64).optional().nullable(),
    color: z.string().max(32).optional().nullable(),
    order: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
});

/** The PATCH form of the same category: every field optional. */
export const forumCategoryUpdateSchema = forumCategorySchema.partial();

/**
 * What a topic's PATCH may carry. The route splits these by role - only the
 * author writes title/content, only an admin flips the pins - so all four
 * are optional here and the route still decides who may set which.
 */
export const forumTopicUpdateSchema = z.object({
    title: z.string().min(3).max(200).optional(),
    content: z.string().min(1).max(50_000).optional(),
    isPinned: z.boolean().optional(),
    isLocked: z.boolean().optional(),
    /**
     * Shown or hidden. The column has always decided what a visitor may see -
     * the reads ask for `APPROVED` and nothing else - and the only screen
     * that could write it was the moderation queue, which lists `PENDING`
     * rows. So a topic that had been approved could not be hidden at all,
     * short of deleting it and losing what it said.
     */
    moderationState: z.enum(["APPROVED", "REJECTED"]).optional(),
});

export const forumTopicSchema = z.object({
    title: z.string().min(3, "Title must be at least 3 characters").max(200),
    slug: z.string().min(1).max(200).optional(),
    content: z.string().min(10, "Content must be at least 10 characters").max(50000, "Content is too long"),
    categoryId: z.string().min(1, "Category is required"),
    isPinned: z.boolean().optional(),
    isLocked: z.boolean().optional(),
});

export const forumPostSchema = z.object({
    content: z.string().min(1, "Content is required").max(50000, "Content is too long"),
    topicId: z.string().min(1, "Topic is required"),
});

// Type exports
export type ForumTopicInput = z.infer<typeof forumTopicSchema>;
export type ForumPostInput = z.infer<typeof forumPostSchema>;
