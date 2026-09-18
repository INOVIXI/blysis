import { Card, CardContent } from "@/core/components/ui/card";
import { Users } from "lucide-react";
import { prisma } from "@/core/lib/db";
import { Link } from "@/core/lib/i18n/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { dateLocaleTag } from "@/core/lib/utils";

/**
 * Users widget - total count + 7-day delta.
 */
export default async function UsersCountWidget() {
    const t = await getTranslations("admin");
    const numberTag = dateLocaleTag(await getLocale());
    let total = 0;
    let last7d = 0;
    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const [a, b] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
        ]);
        total = a;
        last7d = b;
    } catch { /* widget degrades gracefully */ }

    return (
        <Link href="/admin/users" className="block h-full">
            <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("widget_users")}</span>
                        <Users className="w-4 h-4 text-warning" />
                    </div>
                    <div className="text-2xl font-bold">{total.toLocaleString(numberTag)}</div>
                    {last7d > 0 && (
                        <div className="text-xs text-muted-foreground mt-1">{t("widget_usersInLast7Days", { n: last7d })}</div>
                    )}
                </CardContent>
            </Card>
        </Link>
    );
}
