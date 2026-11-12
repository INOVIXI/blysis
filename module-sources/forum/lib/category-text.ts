/**
 * A category's name and description in the reader's language.
 *
 * Whose translations these are, in core's table, and the fields that have
 * them, each language held to its column's own limit. Only the operator's
 * sections are translated: a topic or a reply is what a member wrote, in the
 * language they wrote it in.
 */
import { prisma, translateContent } from "@/core/sdk/server";

export const CATEGORY_TEXT = { owner: "forum", entity: "category" };
export const TRANSLATED_FIELDS = { name: 100, description: 500 };

/**
 * Topics with the section each is in named in `locale`, and the original
 * where the admin wrote none. One query for the page, however many sections
 * its topics are spread over.
 */
export async function withCategoryNames<T extends { category: { id: string; name: string } | null }>(
    topics: T[],
    locale: string,
): Promise<T[]> {
    const sections = new Map<string, { id: string; name: string }>();
    for (const topic of topics) if (topic.category) sections.set(topic.category.id, topic.category);
    const named = await translateContent(prisma, CATEGORY_TEXT, [...sections.values()], ["name"], locale);
    const nameOf = new Map(named.map((section) => [section.id, section.name]));
    return topics.map((topic) => topic.category
        ? { ...topic, category: { ...topic.category, name: nameOf.get(topic.category.id) ?? topic.category.name } }
        : topic);
}
