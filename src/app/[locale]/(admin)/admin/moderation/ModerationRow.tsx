"use client";

import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { Link } from "@/core/lib/i18n/navigation";
import { Checkbox } from "@/core/components/ui/checkbox";
import { Badge } from "@/core/components/ui/badge";
import { useLocalDateTime } from "@/core/hooks/useLocalDate";

export interface ModerationDecisionView {
    reason: string | null;
    note: string | null;
    decidedBy: { id: string; username: string } | null;
    reviewer: string | null;
    decidedAt: string;
}

export interface ModerationRowItem {
    id: string;
    type: string;
    author: { id: string; username: string } | null;
    preview: string;
    title?: string;
    createdAt: string;
    href?: string;
    /** Present in the Rejected view: why the item is there. */
    decision?: ModerationDecisionView | null;
}

interface ModerationRowProps {
    item: ModerationRowItem;
    kindLabel: string;
    selected: boolean;
    onToggle: () => void;
    /** The row's own answers; the queue and the Rejected view offer different ones. */
    actions: React.ReactNode;
}

/** One item in the queue or in the Rejected view. */
export function ModerationRow({ item, kindLabel, selected, onToggle, actions }: ModerationRowProps) {
    const t = useTranslations("admin");
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDateTime = useLocalDateTime();
    const decision = item.decision;

    return (
        <div className="p-4 flex items-start gap-3">
            <Checkbox
                checked={selected}
                onChange={onToggle}
                aria-label={t("common_selectRow")}
                className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {/* A name, set as a name. It was uppercased and in a
                        monospace face, which is how this site draws a
                        machine's word. */}
                    <Badge tone="neutral">{kindLabel}</Badge>
                    <span className="font-medium text-sm">
                        {item.author?.username ?? t("moderation_anonymous")}
                    </span>
                    {item.title && (
                        <span className="text-xs text-muted-foreground truncate">
                            {t("moderation_onTitle", { title: item.title })}
                        </span>
                    )}
                    {item.href && (
                        <Link
                            href={item.href}
                            target="_blank"
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                        >
                            <ExternalLink className="w-3 h-3" aria-hidden="true" /> {t("moderation_view")}
                        </Link>
                    )}
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-3">
                    {item.preview}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                    {formatDateTime(item.createdAt)}
                </p>
                {decision && (
                    <div className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs space-y-0.5">
                        {decision.reason && (
                            <p className="text-foreground">{t("moderation_decisionReason", { reason: decision.reason })}</p>
                        )}
                        {decision.note && (
                            <p className="text-muted-foreground whitespace-pre-wrap">{t("moderation_decisionNote", { note: decision.note })}</p>
                        )}
                        <p className="text-muted-foreground">
                            {decision.decidedBy
                                ? t("moderation_decidedBy", { name: decision.decidedBy.username, when: formatDateTime(decision.decidedAt) })
                                : t("moderation_decidedAt", { when: formatDateTime(decision.decidedAt) })}
                        </p>
                    </div>
                )}
            </div>
            {/*
              * The answers a row is waiting for, and they are the point of
              * the screen. They were an outline button holding a grey tick and
              * a ghost button holding a red cross - so the one thing an
              * operator came here to do was the faintest thing on the row, and
              * the two halves of one decision did not look like a pair. They
              * say what they do now, and the same words appear on the bar
              * above when several rows are ticked.
              */}
            <div className="flex shrink-0 gap-2">{actions}</div>
        </div>
    );
}
