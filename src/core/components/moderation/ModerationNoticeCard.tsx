"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/core/lib/i18n/navigation";
import { Card, CardContent } from "@/core/components/ui/card";
import { Badge } from "@/core/components/ui/badge";
import { useLocalDateTime } from "@/core/hooks/useLocalDate";
import type { ModerationNotice } from "@/core/lib/moderation-notice";

interface ModerationNoticeCardProps {
    notice: ModerationNotice;
}

/**
 * What happened to something a member wrote, told to them.
 *
 * A client component only for the date: it is read in the site's zone, which
 * the browser knows and the server render does not.
 */
export function ModerationNoticeCard({ notice }: ModerationNoticeCardProps) {
    const t = useTranslations("profile");
    const formatDateTime = useLocalDateTime();
    const tone = notice.state === "REJECTED" ? "danger" : notice.state === "PENDING" ? "warning" : "success";
    const status = {
        REJECTED: t("moderationNotice_rejected"),
        PENDING: t("moderationNotice_pending"),
        APPROVED: t("moderationNotice_approved"),
    }[notice.state];

    return (
        <Card>
            <CardContent className="p-6 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={tone}>{status}</Badge>
                    {notice.decidedAt && (
                        <span className="text-xs text-muted-foreground">
                            {t("moderationNotice_decidedAt", { when: formatDateTime(notice.decidedAt) })}
                        </span>
                    )}
                </div>

                {notice.state === "REJECTED" && (
                    <div>
                        <p className="text-sm font-medium text-foreground">{t("moderationNotice_reason")}</p>
                        <p className="text-sm text-muted-foreground">{notice.reason ?? t("moderationNotice_noReason")}</p>
                    </div>
                )}

                <div>
                    <p className="text-sm font-medium text-foreground">
                        {notice.title ? t("moderationNotice_yourPostOn", { title: notice.title }) : t("moderationNotice_yourPost")}
                    </p>
                    {/* What the member typed, as text: never rendered as markup here. */}
                    <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap break-words line-clamp-6">{notice.excerpt}</p>
                </div>

                {notice.state === "APPROVED" && notice.href && (
                    <Link href={notice.href} className="text-sm text-primary hover:underline">
                        {t("moderationNotice_open")}
                    </Link>
                )}
            </CardContent>
        </Card>
    );
}
