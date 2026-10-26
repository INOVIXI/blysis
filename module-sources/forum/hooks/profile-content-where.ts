/**
 * Answers `profile.contentWhere`: which of a member's topics and replies their
 * public profile may count, list and name.
 *
 * A profile is a public page, so it shows what a visitor could open and no
 * more, whoever is looking: a topic in a section the matrix leaves open to
 * somebody with no role, a reply to an approved topic in one, and nothing at
 * all on a forum its operator has closed to visitors. The profile held these
 * to the moderation state alone, and named a staff room's topics, with their
 * opening words, on every profile.
 */
import { moduleSettings } from "@/core/sdk/server";
import { visibleCategoryIds } from "../lib/visible-categories";

type Where = Record<string, unknown>;

const contentWhere = async (where: Where | null, asked?: { kind: string }): Promise<Where | null> => {
    if (where === null || (asked?.kind !== "topics" && asked?.kind !== "posts")) return where;

    const { allowGuestView } = await moduleSettings<{ allowGuestView: boolean }>("forum");
    if (!allowGuestView) return null;

    const readable = await visibleCategoryIds(null);
    const inReadable: Where = readable.everything ? {} : { categoryId: { in: readable.categoryIds } };
    if (asked.kind === "topics") return { AND: [where, inReadable] };
    return { AND: [where, { topic: { moderationState: "APPROVED", ...inReadable } }] };
};

export default contentWhere;
