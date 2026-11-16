import { z } from "zod";
import { isPictureAddress } from "@/core/sdk";

// ==================== BLOG SCHEMAS ====================

/**
 * A picture: a web address or the site's own upload (`isPictureAddress`).
 * `.url()` refused an upload, which answers `/uploads/...`, and took any
 * scheme at all.
 */
const picture = z.string().trim().max(2_000).refine((value) => isPictureAddress(value), "Not a picture address");

export const blogCategorySchema = z.object({
    name: z.string().min(1, "Name is required").max(100),
    slug: z.string().min(1).max(200).optional(),
    description: z.string().max(500).optional(),
});

/**
 * The ArticleStatus enum, once - shared by the write schema and the list
 * endpoint's `?status=` filter so a status one accepts is one the other knows.
 */
export const ARTICLE_STATUSES = ["DRAFT", "PUBLISHED", "SCHEDULED", "ARCHIVED"] as const;

export const blogArticleSchema = z.object({
    title: z.string().min(3, "Title must be at least 3 characters").max(200),
    slug: z.string().min(1).max(200).optional(),
    excerpt: z.string().max(500).optional(),
    content: z.string().min(10, "Content must be at least 10 characters").max(100000, "Content is too long"),
    // The form sends "" for no cover, which is no cover rather than a bad one.
    coverImage: z.preprocess((value) => (value === "" ? null : value), picture.nullable().optional()),
    status: z.enum(ARTICLE_STATUSES).optional(),
    publishedAt: z.string().datetime().optional().nullable(),
    publishAt: z.string().datetime().optional().nullable(),
    categoryId: z.string().optional().nullable(),
    tags: z.array(z.string()).optional(),
});

export const blogCommentSchema = z.object({
    content: z.string().min(1, "Comment is required").max(2000),
    articleId: z.string().min(1),
});

/** The only field the moderation screen sends when it approves or hides one. */
export const blogCommentModerationSchema = z.object({
    isApproved: z.boolean(),
});

// Type exports
export type BlogArticleInput = z.infer<typeof blogArticleSchema>;
