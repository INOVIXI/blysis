import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { prisma } from "@/core/lib/db";
import { Link } from "@/core/lib/i18n/navigation";
import { getLocale, getTimeZone, getTranslations } from "next-intl/server";
import { localizeActivityTitle } from "@/core/lib/activity-title";
import { dateLocaleTag } from "@/core/lib/utils";
import { formatInZone } from "@/core/lib/format-date";

/**
 * Activity feed widget - 5 most recent public feed items.
 */
export default async function ActivityFeedWidget() {
    const t = await getTranslations("admin");
    const activityT = await getTranslations("activity");
    const locale = await getLocale();
    // A server component, so the hook that does this everywhere else is not
    // available. The zone comes from the same request config the client
    // provider reads, so the two never disagree about what day it is.
    const zone = await getTimeZone();
    const formatDate = (value: Date) => formatInZone(value, dateLocaleTag(locale), zone);
    let items: Array<{ id: string; type: string; title: string; createdAt: Date; actor: { username: string } | null }> = [];
    try {
        items = await prisma.activityFeedItem.findMany({
            where: { isPublic: true },
            orderBy: { createdAt: "desc" },
            take: 5,
            include: { actor: { select: { username: true } } },
        });
    } catch { /* degrade */ }

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">{t("widget_recentActivity")}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
                {items.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">{t("widget_noActivity")}</p>
                ) : (
                    <ul className="space-y-1.5">
                        {items.map((item) => (
                            <li key={item.id} className="text-xs flex items-center justify-between gap-2">
                                <span className="truncate">
                                    {item.actor?.username && <span className="font-medium">{item.actor.username}</span>}
                                    {item.actor?.username && " "}
                                    {localizeActivityTitle(item.type, item.title, activityT)}
                                </span>
                                <span className="text-muted-foreground whitespace-nowrap">
                                    {formatDate(item.createdAt)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                <Link href="/activity" className="text-xs text-primary hover:underline mt-2 inline-block">
                    {t("widget_viewAll")} →
                </Link>
            </CardContent>
        </Card>
    );
}
