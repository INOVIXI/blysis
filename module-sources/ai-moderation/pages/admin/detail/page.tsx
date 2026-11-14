"use client";

/**
 * One decision the AI reviewer made: the post, what the model said and why,
 * and the way back from it. The post is read through core when the page
 * opens; one since deleted reads as gone.
 */
import { useLocale, useTranslations } from "next-intl";
import { use, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Check, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, LoadFailed, buttonClassName, useConfirm, useLocalDateTime } from "@/core/sdk/ui";
import { AdminPageHeader } from "@/core/sdk/admin";
import { outcomeOf, outcomeTone } from "../../../lib/outcome";

interface Detail {
    review: {
        id: string;
        provider: string;
        verdict: string;
        applied: string;
        confidence: number | null;
        rationale: string | null;
        model: string | null;
        error: string | null;
        createdAt: string;
    };
    item: { title?: string; body: string; state: "APPROVED" | "REJECTED" | "PENDING"; href?: string } | null;
    reason: string | null;
}

interface PageProps {
    params: Promise<{ id: string; locale: string }>;
}

export default function AiModerationDetailPage(props: PageProps) {
    const { id } = use(props.params);
    const t = useTranslations("aiModeration");
    const locale = useLocale();
    const { confirm } = useConfirm();
    const when = useLocalDateTime();
    const [detail, setDetail] = useState<Detail | null>(null);
    const [failed, setFailed] = useState(false);
    const [working, setWorking] = useState(false);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            const res = await fetch(`/api/v1/ai-moderation/admin/reviews/${encodeURIComponent(id)}?locale=${encodeURIComponent(locale)}`);
            if (!res.ok) throw new Error(String(res.status));
            setDetail(await res.json());
        } catch {
            setFailed(true);
        }
    }, [id, locale]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { load(); }, [load]);

    const takeBack = async (action: "approve" | "requeue") => {
        const ok = await confirm({
            title: action === "approve" ? t("undo_approveTitle") : t("undo_requeueTitle"),
            message: action === "approve" ? t("undo_approveConfirm", { count: 1 }) : t("undo_requeueConfirm", { count: 1 }),
            confirmText: action === "approve" ? t("undo_approve") : t("undo_requeue"),
        });
        if (!ok) return;
        setWorking(true);
        try {
            const res = await fetch("/api/v1/ai-moderation/admin/undo", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ ids: [id], action }),
            });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            toast.success(t("undo_done", { count: data.affected ?? 0 }));
            load();
        } catch {
            toast.error(t("undo_failed"));
        } finally {
            setWorking(false);
        }
    };

    const back = (
        <Link href="/admin/ai-moderation" className={buttonClassName("outline")}>
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {t("detail_back")}
        </Link>
    );

    if (failed) {
        return (
            <>
                <AdminPageHeader title={t("detail_title")} actions={back} />
                <Card><CardContent><LoadFailed onRetry={load} /></CardContent></Card>
            </>
        );
    }
    if (!detail) {
        return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
    }

    const { review, item, reason } = detail;
    const shown = outcomeOf(review);
    const state = item ? { APPROVED: t("state_approved"), REJECTED: t("state_rejected"), PENDING: t("state_pending") }[item.state] : null;

    return (
        <>
            <AdminPageHeader title={t("detail_title")} description={when(review.createdAt)} actions={back} />
            <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle className="text-base">{item?.title ?? t("detail_post")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {item ? (
                            <>
                                {/* What a member wrote, as text: never rendered as markup here. */}
                                <p className="text-sm whitespace-pre-wrap break-words">{item.body}</p>
                                {item.href && (
                                    <Link href={item.href} target="_blank" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> {t("detail_openPost")}
                                    </Link>
                                )}
                            </>
                        ) : (
                            <p className="text-sm text-muted-foreground">{t("detail_postGone")}</p>
                        )}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">{t("detail_decision")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                        <div className="flex flex-wrap gap-2">
                            <Badge tone={outcomeTone(shown)}>{t(`outcome_${shown}`)}</Badge>
                            {state && <Badge tone="neutral">{t("detail_now", { state })}</Badge>}
                        </div>
                        {review.confidence !== null && <p>{t("log_confidence", { value: review.confidence })}</p>}
                        {reason && <p>{t("detail_reason", { reason })}</p>}
                        {review.error ? (
                            <p className="text-muted-foreground">{t(review.error === "missing" ? "error_missing" : "error_call")}</p>
                        ) : (
                            review.rationale && (
                                <div>
                                    <p className="font-medium">{t("detail_rationale")}</p>
                                    <p className="text-muted-foreground whitespace-pre-wrap">{review.rationale}</p>
                                </div>
                            )
                        )}
                        <p className="text-xs text-muted-foreground">{t("detail_model", { model: review.model ?? t("detail_modelFast") })}</p>
                        {item && (
                            <div className="flex flex-wrap gap-2 pt-2">
                                {item.state !== "APPROVED" && (
                                    <Button size="sm" onClick={() => takeBack("approve")} disabled={working}>
                                        <Check className="w-4 h-4" aria-hidden="true" /> {t("undo_approve")}
                                    </Button>
                                )}
                                {item.state !== "PENDING" && (
                                    <Button size="sm" variant="outline" onClick={() => takeBack("requeue")} disabled={working}>
                                        <RotateCcw className="w-4 h-4" aria-hidden="true" /> {t("undo_requeue")}
                                    </Button>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </>
    );
}
