/**
 * Answers `profile.recentTopics`: a member's newest topics, as a visitor may
 * read them.
 *
 * A profile is a public page, so it lists what a visitor could open and no
 * more, whoever is looking: approved, in a section the matrix leaves open to
 * somebody with no role, and nothing at all on a forum its operator has
 * closed to visitors. The profile read the table itself before it asked, and
 * named a staff room's topics and the moderation queue's on every profile.
 */
import { moduleSettings, prisma } from "@/core/sdk/server";
import { visibleCategoryIds } from "../lib/visible-categories";

/**
 * Stated here rather than taken from `HookHandlerFor<"profile.recentTopics">`:
 * that shape is declared by member-profiles, and a site with the forum and
 * without it still builds this file.
 */
interface RecentTopic {
    id: string;
    title: string;
    slug: string;
    createdAt: Date;
}

const recentTopics = async (current: RecentTopic[], who?: { userId: string }): Promise<RecentTopic[]> => {
    if (!who?.userId) return current;

    const { allowGuestView } = await moduleSettings<{ allowGuestView: boolean }>("forum");
    if (!allowGuestView) return current;

    const readable = await visibleCategoryIds(null);
    const topics = await prisma.forumTopic.findMany({
        where: {
            authorId: who.userId,
            moderationState: "APPROVED",
            ...(readable.everything ? {} : { categoryId: { in: readable.categoryIds } }),
        },
        select: { id: true, title: true, slug: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5,
    });
    return [...current, ...topics];
};

export default recentTopics;
