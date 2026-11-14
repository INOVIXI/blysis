"use client";

/**
 * What the AI reviewer decided, newest first, and the way back from it.
 *
 * Each row says what was answered and how sure the model was, with its reasons
 * for the moderators; opening one shows the post. Approving or putting rows
 * back in the queue is the admin's own decision, made through core.
 */
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, RotateCcw, Settings } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { Badge, Button, Card, CardContent, Checkbox, ListControls, Pagination, buttonClassName, useConfirm, useLocalDateTime, useRowPicks } from "@/core/sdk/ui";
import { AdminPageHeader, BulkBar } from "@/core/sdk/admin";
import { outcomeOf, outcomeTone, type Outcome } from "../../lib/outcome";

interface Review {
    id: string;
    provider: string;
    verdict: string;
    applied: string;
    reasonId: string | null;
    confidence: number | null;
    rationale: string | null;
    error: string | null;
    createdAt: string;
}

interface Kind {
    id: string;
    label: string;
    labelKey?: string;
}

const OUTCOMES: Outcome[] = ["approve", "reject", "leave", "error"];
const PERIODS = ["1", "7", "30"] as const;

export default function AiModerationLogPage() {
    const t = useTranslations("aiModeration");
    const tAdmin = useTranslations("admin");
    const locale = useLocale();
    const query = useSearchParams();
    const { confirm } = useConfirm();
    const when = useLocalDateTime();
    const [outcome, setOutcome] = useState(() => {
        const asked = query?.get("applied") ?? "";
        return (OUTCOMES as string[]).includes(asked) ? asked : "";
    });
    const [period, setPeriod] = useState(() => {
        const asked = query?.get("days") ?? "";
        return (PERIODS as readonly string[]).includes(asked) ? asked : "";
    });
    const [kind, setKind] = useState("");
    const [kinds, setKinds] = useState<Kind[]>([]);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const picks = useRowPicks(reviews);

    useEffect(() => {
        fetch(`/api/v1/ai-moderation/admin/options?locale=${encodeURIComponent(locale)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => setKinds(data?.kinds ?? []))
            .catch(() => setKinds([]));
    }, [locale]);

    const load = useCallback(async () => {
        const params = new URLSearchParams({ page: String(page) });
        if (outcome) params.set("applied", outcome);
        if (kind) params.set("kind", kind);
        if (period) params.set("days", period);
        try {
            const res = await fetch(`/api/v1/ai-moderation/admin/reviews?${params}`);
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            setReviews(data.reviews ?? []);
            setPages(Math.max(1, Math.ceil((data.total ?? 0) / (data.limit ?? 50))));
        } catch {
            toast.error(t("log_loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [page, outcome, kind, period, t]);

    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { load(); }, [load]);

    const kindName = (id: string) => {
        const found = kinds.find((k) => k.id === id);
        if (!found) return id;
        return found.labelKey && tAdmin.has(found.labelKey) ? tAdmin(found.labelKey) : found.label;
    };

    const takeBack = async (action: "approve" | "requeue") => {
        const count = picks.picked.size;
        const ok = await confirm({
            title: action === "approve" ? t("undo_approveTitle") : t("undo_requeueTitle"),
            message: action === "approve" ? t("undo_approveConfirm", { count }) : t("undo_requeueConfirm", { count }),
            confirmText: action === "approve" ? t("undo_approve") : t("undo_requeue"),
        });
        if (!ok) return;
        setWorking(true);
        try {
            const res = await fetch("/api/v1/ai-moderation/admin/undo", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ ids: [...picks.picked], action }),
            });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            toast.success(t("undo_done", { count: data.affected ?? 0 }));
            picks.clear();
            load();
        } catch {
            toast.error(t("undo_failed"));
        } finally {
            setWorking(false);
        }
    };

    const filter = (setter: (value: string) => void) => (value: string) => {
        setter(value);
        setPage(1);
    };

    return (
        <>
            <AdminPageHeader
                title={t("log_title")}
                description={t("log_subtitle")}
                actions={
                    <Link href="/admin/ai-moderation/settings" className={buttonClassName("outline")}>
                        <Settings className="w-4 h-4" aria-hidden="true" /> {t("log_settings")}
                    </Link>
                }
            />
            <ListControls
                className="mb-4"
                filters={[
                    {
                        id: "outcome",
                        label: t("filter_outcome"),
                        value: outcome,
                        options: [{ value: "", label: t("outcome_all") }, ...OUTCOMES.map((o) => ({ value: o, label: t(`outcome_${o}`) }))],
                        onChange: filter(setOutcome),
                    },
                    {
                        id: "kind",
                        label: t("filter_kind"),
                        value: kind,
                        options: [{ value: "", label: t("kind_all") }, ...kinds.map((k) => ({ value: k.id, label: kindName(k.id) }))],
                        onChange: filter(setKind),
                    },
                    {
                        id: "period",
                        label: t("filter_period"),
                        value: period,
                        options: [{ value: "", label: t("period_all") }, ...PERIODS.map((p) => ({ value: p, label: t(`period_${p}`) }))],
                        onChange: filter(setPeriod),
                    },
                ]}
            />
            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    ) : reviews.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">{t("log_empty")}</p>
                    ) : (
                        <>
                            <BulkBar
                                state={picks.headerState}
                                count={picks.picked.size}
                                onToggleAll={picks.toggleAll}
                                actions={
                                    <>
                                        <Button size="sm" onClick={() => takeBack("approve")} disabled={working}>
                                            <Check className="w-4 h-4" aria-hidden="true" /> {t("undo_approve")}
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => takeBack("requeue")} disabled={working}>
                                            <RotateCcw className="w-4 h-4" aria-hidden="true" /> {t("undo_requeue")}
                                        </Button>
                                    </>
                                }
                            />
                            <ul className="divide-y divide-border">
                                {reviews.map((review) => {
                                    const shown = outcomeOf(review);
                                    return (
                                        <li key={review.id} className="p-4 flex items-start gap-3">
                                            <Checkbox
                                                checked={picks.picked.has(review.id)}
                                                onChange={() => picks.toggle(review.id)}
                                                aria-label={t("log_pick")}
                                                className="mt-0.5"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex flex-wrap items-center gap-2 mb-1">
                                                    <Badge tone={outcomeTone(shown)}>{t(`outcome_${shown}`)}</Badge>
                                                    <Badge tone="neutral">{kindName(review.provider)}</Badge>
                                                    {review.confidence !== null && (
                                                        <span className="text-xs text-muted-foreground">{t("log_confidence", { value: review.confidence })}</span>
                                                    )}
                                                    <span className="text-xs text-muted-foreground">{when(review.createdAt)}</span>
                                                </div>
                                                <p className="text-sm text-muted-foreground line-clamp-2">
                                                    {review.error ? t(`error_${review.error === "missing" ? "missing" : "call"}`) : review.rationale}
                                                </p>
                                            </div>
                                            <Link href={`/admin/ai-moderation/${review.id}`} className="text-sm text-primary hover:underline shrink-0">
                                                {t("log_open")}
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </>
                    )}
                    <Pagination page={page} pages={pages} onPageChange={setPage} />
                </CardContent>
            </Card>
        </>
    );
}
