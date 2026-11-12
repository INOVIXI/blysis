/**
 * The blog's words in the reader's language.
 *
 * An article's title, excerpt and body and a category's name and description
 * keep the text the admin typed in their own columns, the original, which
 * the slug, search, the sitemap and every hook go on reading. A translation
 * is a row in core's translation table, written by the editor beside the
 * record and read here, a page at a time, for whoever is reading. A reader
 * whose language has none reads the original.
 *
 * The limits are the write schema's own, so a translation can be no longer
 * than the text it translates could be.
 */
import { prisma, translateContent } from "@/core/sdk/server";

export const ARTICLE_TEXT = { owner: "blog", entity: "article" };
export const CATEGORY_TEXT = { owner: "blog", entity: "category" };

export const ARTICLE_FIELDS = { title: 200, excerpt: 500, content: 100_000 };
export const CATEGORY_FIELDS = { name: 100, description: 500 };

interface Named {
    id: string;
    name: string;
}

/** Categories in `locale`: one query for all of them. */
export function categoriesIn<T extends Named & { description?: string | null }>(rows: T[], locale: string): Promise<T[]> {
    return translateContent(prisma, CATEGORY_TEXT, rows, ["name", "description"] as (keyof T & string)[], locale);
}

/**
 * Articles in `locale`, with the category each sits in: one query for the
 * articles and one for their categories, whatever the length of the page.
 * Only the fields a row was read with are translated, so a sidebar that reads
 * titles alone is not handed a body.
 */
export async function articlesIn<T extends { id: string; title: string; category?: Named | null }>(rows: T[], locale: string): Promise<T[]> {
    const read = await translateContent(prisma, ARTICLE_TEXT, rows, ["title", "excerpt", "content"] as (keyof T & string)[], locale);
    const sections = [...new Map(
        read.flatMap((row) => (row.category ? [[row.category.id, row.category] as const] : [])),
    ).values()];
    if (sections.length === 0) return read;
    const named = new Map((await translateContent(prisma, CATEGORY_TEXT, sections, ["name"], locale)).map((row) => [row.id, row]));
    return read.map((row) => (row.category ? { ...row, category: named.get(row.category.id) ?? row.category } : row));
}

/** The reader's language an API route was asked in, or none for the originals. */
export function localeOf(request: Request): string {
    return new URL(request.url).searchParams.get("locale") ?? "";
}
