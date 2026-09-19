"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Pagination } from "@/core/components/ui/pagination";
import { ListControls } from "@/core/components/ui/list-controls";
import { Checkbox } from "@/core/components/ui/checkbox";
import { BulkBar } from "@/core/components/admin/BulkBar";
import { RowActions } from "@/core/components/admin/RowActions";
import { useRowPicks } from "@/core/hooks/useRowList";
import { deleteEach } from "@/core/lib/bulk-delete";
import { ChevronDown, ChevronUp, Loader2, Play, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { useTranslations } from "next-intl";
import { badgeClassName, type BadgeTone } from "@/core/components/ui/badge";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { useLocalDateTime } from "@/core/hooks/useLocalDate";

type EmailStatus = "pending" | "sending" | "sent" | "failed";
type StatusFilter = "all" | EmailStatus;

interface EmailJobRow {
    id: string;
    to: string;
    subject: string;
    status: string;
    attempts: number;
    lastError: string | null;
    scheduledAt: string;
    sentAt: string | null;
    createdAt: string;
}

interface QueueResponse {
    jobs: EmailJobRow[];
    total: number;
    page: number;
    pageSize: number;
    summary: Record<EmailStatus, number>;
}

/**
 * The message key per queue status. The four summary cards above the table
 * already used these; the chip in each row printed the column instead.
 */
const STATUS_LABEL: Record<string, string> = {
    pending: "emailQueue_pending",
    sending: "emailQueue_sending",
    sent: "emailQueue_sent",
    failed: "emailQueue_failed",
};

const STATUS_TONE: Record<string, BadgeTone> = {
    pending: "info",
    sending: "warning",
    sent: "success",
    failed: "danger",
};

const STATUS_CARD: { key: EmailStatus; labelKey: string; color: string }[] = [
    { key: "pending", labelKey: "emailQueue_pending", color: "text-primary" },
    { key: "sending", labelKey: "emailQueue_sending", color: "text-warning" },
    { key: "sent", labelKey: "emailQueue_sent", color: "text-success" },
    { key: "failed", labelKey: "emailQueue_failed", color: "text-destructive" },
];

const TABS: { key: StatusFilter; labelKey: string }[] = [
    { key: "all", labelKey: "emailQueue_all" },
    { key: "pending", labelKey: "emailQueue_pending" },
    { key: "sending", labelKey: "emailQueue_sending" },
    { key: "sent", labelKey: "emailQueue_sent" },
    { key: "failed", labelKey: "emailQueue_failed" },
];

export default function EmailQueueAdminPage() {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDateTime = useLocalDateTime();
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    const [jobs, setJobs] = useState<EmailJobRow[]>([]);
    const [summary, setSummary] = useState<Record<EmailStatus, number>>({ pending: 0, sending: 0, sent: 0, failed: 0 });
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [filter, setFilter] = useState<StatusFilter>("all");
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const { confirm } = useConfirm();
    // Sent to the endpoint: the queue only grows, and the twenty rows in the
    // browser are not the queue.
    const [search, setSearch] = useState("");
    // The endpoint pages this, so only the ticking is the screen's. A queue
    // that failed overnight is a hundred rows an operator wants gone at once.
    const picks = useRowPicks(jobs);

    const fetchJobs = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (filter !== "all") params.set("status", filter);
            if (search.trim()) params.set("q", search.trim());
            params.set("page", String(page));
            const res = await fetch(`/api/v1/admin/email-queue?${params.toString()}`);
            if (!res.ok) {
                toast.error(t("emailQueue_loadFailed"));
                return;
            }
            const data: QueueResponse = await res.json();
            setJobs(data.jobs || []);
            setTotal(data.total || 0);
            setPageSize(data.pageSize || 50);
            setSummary(data.summary || { pending: 0, sending: 0, sent: 0, failed: 0 });
        } catch {
            toast.error(t("emailQueue_loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [filter, page, search, t]);

    useEffect(() => {
        void fetchJobs();
    }, [fetchJobs]);

    const handleProcess = async () => {
        const ok = await confirm({
            title: t("emailQueue_processTitle"),
            message: t("emailQueue_processConfirm"),
            confirmText: t("emailQueue_process"),
        });
        if (!ok) return;

        setProcessing(true);
        try {
            const res = await fetch("/api/v1/admin/email-queue/process", { method: "POST" });
            if (res.ok) {
                const data = await res.json();
                toast.success(
                    `Processed ${data.processed} · sent ${data.sent} · failed ${data.failed} · retried ${data.retried}`
                );
                void fetchJobs();
            } else {
                toast.error(t("emailQueue_processFailed"));
            }
        } catch {
            toast.error(t("emailQueue_processFailed"));
        } finally {
            setProcessing(false);
        }
    };

    const handleRetry = async (job: EmailJobRow) => {
        const ok = await confirm({
            title: t("emailQueue_retryTitle"),
            message: t("emailQueue_retryConfirm", { subject: job.subject }),
            confirmText: t("emailQueue_retry"),
        });
        if (!ok) return;

        setBusyId(job.id);
        try {
            const res = await fetch(`/api/v1/admin/email-queue/${job.id}/retry`, { method: "POST" });
            if (res.ok) {
                toast.success(t("emailQueue_retrySuccess"));
                void fetchJobs();
            } else {
                toast.error(t("emailQueue_retryFailed"));
            }
        } finally {
            setBusyId(null);
        }
    };

    const deleteMany = async () => {
        const ok = await confirm({
            title: t("emailQueue_deleteTitle"),
            message: t("crud_deleteItemsConfirm", { count: picks.picked.size }),
            variant: "danger",
            confirmText: t("common_delete"),
        });
        if (!ok) return;
        const { deleted, total } = await deleteEach([...picks.picked], async (id) => {
            const res = await fetch(`/api/v1/admin/email-queue/${id}`, { method: "DELETE" });
            return res.ok;
        });
        picks.clear();
        fetchJobs();
        if (deleted === total) toast.success(t("crud_deleted"));
        else if (deleted === 0) toast.error(t("crud_deleteFailed"));
        else toast.error(t("crud_deletedPartly", { deleted, total }));
    };

    const handleDelete = async (job: EmailJobRow) => {
        const ok = await confirm({
            title: t("emailQueue_deleteTitle"),
            message: `Delete "${job.subject}"? This cannot be undone.`,
            variant: "danger",
        });
        if (!ok) return;

        setBusyId(job.id);
        try {
            const res = await fetch(`/api/v1/admin/email-queue/${job.id}`, { method: "DELETE" });
            if (res.ok) {
                toast.success(t("emailQueue_jobDeleted"));
                void fetchJobs();
            } else {
                toast.error(t("emailQueue_deleteFailed"));
            }
        } finally {
            setBusyId(null);
        }
    };

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return (
        <>
            <AdminPageHeader
                title={t("emailQueue_title")}
                description={t("emailQueue_description")}
                actions={<>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => void fetchJobs()} disabled={loading}>
                            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                            {t("common_refresh")}
                        </Button>
                        <Button onClick={handleProcess} disabled={processing}>
                            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                            {t("emailQueue_processNow")}
                        </Button>
                    </div>
                </>}
            />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                {STATUS_CARD.map((s) => (
                    <Card key={s.key}>
                        <CardContent className="p-4">
                            <div className="text-xs uppercase font-mono text-muted-foreground">{t(s.labelKey)}</div>
                            <div className={`text-2xl font-bold ${s.color}`}>{summary[s.key] ?? 0}</div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <ListControls
                className="mb-4"
                search={{ value: search, onChange: (term) => { setSearch(term); setPage(1); } }}
            />

            <div className="flex gap-1 mb-4 border-b border-border">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        type="button"
                        onClick={() => { setFilter(tab.key); setPage(1); }}
                        className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                            filter === tab.key
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {t(tab.labelKey)}
                    </button>
                ))}
            </div>

            {loading && jobs.length === 0 ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
            ) : jobs.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        {t("emailQueue_noJobs")}
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardContent className="p-0">
                        {/* Outside the scrolling box, or the select-all box
                            goes sideways with the table on a narrow screen. */}
                        <BulkBar
                            state={picks.headerState}
                            count={picks.picked.size}
                            onToggleAll={picks.toggleAll}
                            actions={
                                <Button variant="destructive" size="sm" onClick={deleteMany}>
                                    <Trash2 className="w-4 h-4" /> {t("common_delete")} {picks.picked.size}
                                </Button>
                            }
                        />
                        <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                                <tr>
                                    <th className="w-10 px-4 py-3" />
                                    <th className="px-4 py-3 font-medium">{t("emailQueue_to")}</th>
                                    <th className="px-4 py-3 font-medium">{t("common_subject")}</th>
                                    <th className="px-4 py-3 font-medium">{t("common_status")}</th>
                                    <th className="px-4 py-3 font-medium">{t("emailQueue_attempts")}</th>
                                    <th className="px-4 py-3 font-medium">{t("emailQueue_scheduled")}</th>
                                    <th className="px-4 py-3 font-medium text-right">{t("common_actions")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {jobs.map((job) => {
                                    const isExpanded = expandedId === job.id;
                                    const hasError = job.status === "failed" && job.lastError;
                                    return (
                                        <Fragment key={job.id}>
                                            <tr className="border-t border-border">
                                                <td className="px-4 py-3">
                                                    <Checkbox
                                                        checked={picks.picked.has(job.id)}
                                                        onChange={() => picks.toggle(job.id)}
                                                        aria-label={t("common_selectRow")}
                                                    />
                                                </td>
                                                <td className="px-4 py-3 truncate max-w-[200px]">{job.to}</td>
                                                <td className="px-4 py-3 truncate max-w-[260px]">{job.subject}</td>
                                                <td className="px-4 py-3">
                                                    <span
                                                        className={badgeClassName(STATUS_TONE[job.status] ?? "neutral", "uppercase font-mono")}
                                                    >
                                                        {STATUS_LABEL[job.status] && t.has(STATUS_LABEL[job.status]) ? t(STATUS_LABEL[job.status]) : job.status}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-muted-foreground">{job.attempts}</td>
                                                <td className="px-4 py-3 text-muted-foreground">{job.scheduledAt ? formatDateTime(job.scheduledAt) : "-"}</td>
                                                <td className="px-4 py-3 text-right">
                                                    {/* One shape. This row
                                                        mixed a text button,
                                                        an outline button with
                                                        an icon and its word,
                                                        and a ghost icon - for
                                                        three things done to
                                                        one job. */}
                                                    <RowActions
                                                        actions={[
                                                            {
                                                                icon: isExpanded ? ChevronUp : ChevronDown,
                                                                label: isExpanded ? t("emailQueue_hide") : t("emailQueue_error"),
                                                                onClick: () => setExpandedId(isExpanded ? null : job.id),
                                                                hidden: !hasError,
                                                            },
                                                            {
                                                                icon: RotateCcw,
                                                                label: t("emailQueue_retry"),
                                                                onClick: () => handleRetry(job),
                                                                disabled: busyId === job.id,
                                                                hidden: job.status !== "failed",
                                                            },
                                                            {
                                                                icon: Trash2,
                                                                label: commonT("delete"),
                                                                onClick: () => handleDelete(job),
                                                                disabled: busyId === job.id,
                                                                destructive: true,
                                                            },
                                                        ]}
                                                    />
                                                </td>
                                            </tr>
                                            {isExpanded && hasError && (
                                                <tr className="border-t border-border bg-muted/20">
                                                    <td colSpan={6} className="px-4 py-3">
                                                        <div className="text-xs font-mono text-destructive whitespace-pre-wrap break-all">
                                                            {job.lastError}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Pagination page={page} pages={totalPages} total={total} onPageChange={setPage} />
        </>
    );
}
