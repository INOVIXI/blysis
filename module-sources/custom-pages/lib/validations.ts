import { z } from "zod";

/**
 * A custom page. `content` is Markdown, sanitised where it is rendered, and was
 * previously accepted at any length the body cap allowed; `order` reached an
 * `Int` column untyped, so a string or a fraction was a 500 rather than a 400.
 */
export const customPageCreateSchema = z.object({
    title: z.string().trim().min(1, "Title and content required").max(200),
    slug: z.string().trim().min(1).max(200).optional(),
    content: z.string().min(1, "Title and content required").max(100_000),
    isActive: z.boolean().optional(),
    order: z.number().int().min(0).max(10_000).optional(),
});

export const customPageUpdateSchema = customPageCreateSchema.partial();

/**
 * Whether a page's content is a document the removed block editor wrote.
 *
 * `content` held one of two grammars for as long as there were two editors
 * pointed at it: Markdown, or the builder's JSON. The builder is gone, and an
 * installation that used it still has pages in the second grammar sitting in
 * the column. Rendering one as Markdown would put a wall of braces in front
 * of a visitor, so it is recognised instead and the page says what happened.
 *
 * The shape, not the parse: a `content` array of objects is what the builder
 * wrote and what nothing else does. A page that genuinely begins with a brace
 * is a page whose first characters are `{"root"` - which Markdown does not
 * produce and nobody types by accident.
 */
export function wasBuiltWithBlocks(content: string): boolean {
    if (!content.trimStart().startsWith("{")) return false;
    try {
        const parsed: unknown = JSON.parse(content);
        if (!parsed || typeof parsed !== "object") return false;
        const blocks = (parsed as { content?: unknown }).content;
        return Array.isArray(blocks);
    } catch {
        return false;
    }
}
