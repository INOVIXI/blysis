"use client";

/**
 * The assistant's answer to the member's last message, on the ticket's staff
 * screen, above the reply box.
 *
 * "Add to reply" puts the text in the reply box; staff read it, change it and
 * send it as themselves, so nothing reaches the member from here. Setting a
 * draft aside takes it off the screen. A member of staff who may not use
 * drafts sees nothing at all.
 */
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bot, CornerDownLeft, ExternalLink, X } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { Badge, Button, Card, CardContent, useConfirm } from "@/core/sdk/ui";

interface DraftPanelProps {
    ticketId: string;
    onUseDraft?: (text: string) => void;
}

interface Draft {
    id: string;
    status: "draft" | "failed";
    reply: string;
    canAnswer: boolean;
    confidence: number | null;
    sources: { source: string; title: string; href?: string }[] | null;
    departmentLabel: string | null;
    priorityLabel: string | null;
}

export default function DraftPanel({ ticketId, onUseDraft }: DraftPanelProps) {
    const t = useTranslations("aiSupport");
    const locale = useLocale();
    const { confirm } = useConfirm();
    const [draft, setDraft] = useState<Draft | null>(null);
    const [failed, setFailed] = useState(false);
    const [working, setWorking] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/v1/ai-support/tickets/${encodeURIComponent(ticketId)}/draft?locale=${encodeURIComponent(locale)}`)
            .then(async (res) => {
                if (cancelled) return;
                // Not allowed to use drafts: there is nothing here for them.
                if (res.status === 401 || res.status === 403) return;
                if (!res.ok) throw new Error(String(res.status));
                const data = await res.json();
                if (!cancelled) setDraft(data?.draft ?? null);
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => { cancelled = true; };
    }, [ticketId, locale]);

    const mark = useCallback(async (status: "used" | "discarded") => {
        if (!draft) return false;
        setWorking(true);
        try {
            const res = await fetch(`/api/v1/ai-support/admin/drafts/${encodeURIComponent(draft.id)}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ status }),
            });
            if (!res.ok) throw new Error(String(res.status));
            return true;
        } catch {
            toast.error(t("draft_actionFailed"));
            return false;
        } finally {
            setWorking(false);
        }
    }, [draft, t]);

    const addToReply = async () => {
        if (!draft) return;
        onUseDraft?.(draft.reply);
        if (await mark("used")) setDraft(null);
    };

    const setAside = async () => {
        const ok = await confirm({ title: t("draft_discardTitle"), message: t("draft_discardConfirm"), confirmText: t("draft_discard") });
        if (ok && (await mark("discarded"))) setDraft(null);
    };

    if (failed) {
        return <p className="text-xs text-muted-foreground">{t("draft_loadFailed")}</p>;
    }
    if (!draft) return null;

    return (
        <Card className="border-dashed">
            <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Bot className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    <span className="text-sm font-medium">{t("draft_title")}</span>
                    {draft.confidence !== null && <Badge tone="neutral">{t("draft_confidence", { value: draft.confidence })}</Badge>}
                    {draft.status === "draft" && !draft.canAnswer && <Badge tone="warning">{t("draft_unsure")}</Badge>}
                </div>
                {draft.status === "failed" ? (
                    <p className="text-sm text-muted-foreground">{t("draft_failed")}</p>
                ) : (
                    <>
                        {/* The model's words, as text: never rendered as markup on this screen. */}
                        <p className="text-sm whitespace-pre-wrap break-words">{draft.reply}</p>
                        {draft.sources && draft.sources.length > 0 && (
                            <div className="text-xs text-muted-foreground space-y-1">
                                <p>{t("draft_sources")}</p>
                                <ul className="space-y-0.5">
                                    {draft.sources.map((source, i) => (
                                        <li key={`${source.source}-${i}`}>
                                            {source.href ? (
                                                <Link href={source.href} target="_blank" className="text-primary hover:underline inline-flex items-center gap-1">
                                                    <ExternalLink className="w-3 h-3" aria-hidden="true" /> {source.title}
                                                </Link>
                                            ) : source.title}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {(draft.departmentLabel || draft.priorityLabel) && (
                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                {draft.departmentLabel && <span>{t("draft_suggestDepartment", { name: draft.departmentLabel })}</span>}
                                {draft.priorityLabel && <span>{t("draft_suggestPriority", { name: draft.priorityLabel })}</span>}
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground">{t("draft_note")}</p>
                    </>
                )}
                <div className="flex flex-wrap gap-2">
                    {draft.status === "draft" && draft.reply && onUseDraft && (
                        <Button size="sm" onClick={addToReply} disabled={working}>
                            <CornerDownLeft className="w-4 h-4" aria-hidden="true" /> {t("draft_use")}
                        </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={setAside} disabled={working}>
                        <X className="w-4 h-4" aria-hidden="true" /> {t("draft_discard")}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
