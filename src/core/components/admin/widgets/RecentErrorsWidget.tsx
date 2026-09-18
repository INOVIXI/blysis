import { Card, CardContent } from "@/core/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { prisma } from "@/core/lib/db";
import { Link } from "@/core/lib/i18n/navigation";
import { getTranslations } from "next-intl/server";

/**
 * Compact KPI card - recent cron error count only.
 * Full list lives on /admin/cron and /admin/observability.
 */
export default async function RecentErrorsWidget() {
    const t = await getTranslations("admin");
    let count = 0;
    try {
        count = await prisma.cronRun.count({ where: { lastStatus: "error" } });
    } catch { /* degrade */ }

    const hasErrors = count > 0;

    return (
        <Link href="/admin/cron" className="block h-full">
            <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            {t("widget_recentErrors")}
                        </span>
                        <AlertTriangle className={`w-4 h-4 ${hasErrors ? "text-warning" : "text-muted-foreground"}`} />
                    </div>
                    <div className={`text-2xl font-bold ${hasErrors ? "text-warning" : ""}`}>{count}</div>
                    {!hasErrors && (
                        <div className="text-xs text-muted-foreground mt-1">{t("widget_noRecentErrors")}</div>
                    )}
                </CardContent>
            </Card>
        </Link>
    );
}
