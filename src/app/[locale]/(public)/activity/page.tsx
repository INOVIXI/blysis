import { getTranslations } from "next-intl/server";
import { PageFrame } from "@/core/components/layout/PageFrame";
import { ActivityFeedList, type ActivityItem } from "@/core/components/activity/ActivityFeedList";
import { prisma } from "@/core/lib/db";
import { getModuleStates } from "@/core/lib/module-cache";
import { coreScreenMetadata } from "@/core/lib/core-screens";

export const dynamic = "force-dynamic";

// The head comes from the CORE_SCREENS row for this path, like every other
// page core renders itself. It used to be written out here, which is how the
// page ended up the only one of the ten with a description at all.
export const generateMetadata = coreScreenMetadata("/activity");

async function fetchPublicFeed(limit = 20): Promise<ActivityItem[]> {
    try {
        const rows = await prisma.activityFeedItem.findMany({
            where: { isPublic: true },
            orderBy: { createdAt: "desc" },
            take: limit,
            include: {
                actor: { select: { id: true, username: true, avatar: true } },
            },
        });
        return rows.map((r) => ({
            id: r.id,
            type: r.type,
            title: r.title,
            body: r.body,
            href: r.href,
            icon: r.icon,
            isPublic: r.isPublic,
            createdAt: r.createdAt.toISOString(),
            actor: r.actor,
        }));
    } catch {
        return [];
    }
}

export default async function ActivityFeedPage() {
    const t = await getTranslations("activity");
    const items = await fetchPublicFeed(20);
    const moduleStates = await getModuleStates();

    /*
     * The frame, like every other public page. This drew its own shell at
     * `max-w-3xl` while the page a reader arrived from was the full measure,
     * so the text jumped narrower on the way in and the crumb trail back was
     * missing. The icon beside the title went with the shell: no other page
     * title wears one.
     */
    return (
        <PageFrame title={t("title")} description={t("description")}>
            <ActivityFeedList items={items} moduleStates={moduleStates} />
        </PageFrame>
    );
}
