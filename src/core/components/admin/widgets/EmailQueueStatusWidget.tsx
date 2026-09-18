import { Card, CardContent } from "@/core/components/ui/card";
import { Inbox } from "lucide-react";
import { prisma } from "@/core/lib/db";
import { Link } from "@/core/lib/i18n/navigation";
import { getTranslations } from "next-intl/server";

/**
 * Email queue status widget - pending/failed counts.
 */
export default async function EmailQueueStatusWidget() {
    const t = await getTranslations("admin");
    let pending = 0;
    let failed = 0;
    try {
        const [p, f] = await Promise.all([
            prisma.emailJob.count({ where: { status: "pending" } }),
            prisma.emailJob.count({ where: { status: "failed" } }),
        ]);
        pending = p;
        failed = f;
    } catch { /* degrade */ }

    return (
        <Link href="/admin/email-queue" className="block h-full">
            <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t("widget_emailQueue")}</span>
                        <Inbox className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex items-baseline gap-3">
                        <div>
                            <div className="text-2xl font-bold">{pending}</div>
                            <div className="text-[10px] uppercase text-muted-foreground">{t("widget_pending")}</div>
                        </div>
                        <div>
                            <div className={`text-2xl font-bold ${failed > 0 ? "text-destructive" : ""}`}>{failed}</div>
                            <div className="text-[10px] uppercase text-muted-foreground">{t("widget_failed")}</div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}
