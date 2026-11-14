"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UserRoundCheck } from "lucide-react";
import { Link, useRouter } from "@/core/lib/i18n/navigation";
import { Card, CardContent } from "@/core/components/ui/card";
import { Badge } from "@/core/components/ui/badge";
import { Button } from "@/core/components/ui/button";
import { useLocalDateTime } from "@/core/hooks/useLocalDate";
import type { ModerationNotice } from "@/core/lib/moderation-notice";

interface ModerationNoticeCardProps {
    notice: ModerationNotice;
    /** The kind and the item, for the address the "ask a person" button posts to. */
    provider: string;
    itemId: string;
}

/**
 * What happened to something a member wrote, told to them.
 *
 * A client component for the date, which is read in the site's zone the
 * browser knows and the server render does not, and for the button that asks
 * a person to look again at what a reviewing module rejected.
 */
export function ModerationNoticeCard({ notice, provider, itemId }: ModerationNoticeCardProps) {
    const t = useTranslations("profile");
    const formatDateTime = useLocalDateTime();
    const router = useRouter();
    const [asking, setAsking] = useState(false);

    const askPerson = async () => {
        setAsking(true);
        try {
            const res = await fetch(`/api/v1/moderation/${encodeURIComponent(provider)}/${encodeURIComponent(itemId)}/ask-person`, { method: "POST" });
            if (!res.ok) {
                const data = (await res.json().catch(() => null)) as { code?: string } | null;
                toast.error(data?.code === "rate_limited" ? t("moderationNotice_askLimited") : t("moderationNotice_askFailed"));
                return;
            }
            toast.success(t("moderationNotice_asked"));
            router.refresh();
        } catch {
            toast.error(t("moderationNotice_askFailed"));
        } finally {
            setAsking(false);
        }
    };
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

                {notice.canAskPerson && (
                    <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
                        <p className="text-sm text-muted-foreground">{t("moderationNotice_byReviewer")}</p>
                        <Button size="sm" variant="outline" onClick={askPerson} disabled={asking}>
                            <UserRoundCheck className="w-4 h-4" aria-hidden="true" /> {t("moderationNotice_askPerson")}
                        </Button>
                    </div>
                )}

                {notice.askedPerson && notice.state === "PENDING" && (
                    <p className="text-sm text-muted-foreground">{t("moderationNotice_personWillLook")}</p>
                )}

                {notice.state === "APPROVED" && notice.href && (
                    <Link href={notice.href} className="text-sm text-primary hover:underline">
                        {t("moderationNotice_open")}
                    </Link>
                )}
            </CardContent>
        </Card>
    );
}
