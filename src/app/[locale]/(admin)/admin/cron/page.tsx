"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Loader2, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { useTranslations } from "next-intl";
import { Badge, type BadgeTone } from "@/core/components/ui/badge";
import { SCHEDULE_NAME_KEY, STATUS_NAME_KEY, type CronSchedule, type CronStatus } from "@/core/lib/cron-schedules";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { errorMessage } from "@/core/lib/write-result";
import { useLocalDateTime } from "@/core/hooks/useLocalDate";

interface CronJobRow {
    key: string;
    schedule: CronSchedule;
    lastRunAt: string | null;
    lastStatus: CronStatus | null;
    lastError: string | null;
    lastRunMs: number | null;
    nextRunAt: string | null;
}

const STATUS_TONE: Record<CronStatus, BadgeTone> = { running: "info", ok: "success", error: "danger" };

function formatDuration(ms: number | null): string {
    if (ms === null || ms === undefined) return "-";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

export default function CronAdminPage() {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDateTime = useLocalDateTime();
    const t = useTranslations("admin");
    /*
     * A cadence and an outcome are both closed sets core owns, so both have a
     * word. A token outside either set is a job the scheduler cannot run or a
     * status it does not write - neither reaches a reader, and showing the
     * token is the only honest thing left to do with one.
     */
    const scheduleName = (schedule: CronSchedule) => {
        const key = SCHEDULE_NAME_KEY[schedule];
        return key && t.has(key) ? t(key) : schedule;
    };
    const statusName = (status: CronStatus) => {
        const key = STATUS_NAME_KEY[status];
        return key && t.has(key) ? t(key) : status;
    };
    const [jobs, setJobs] = useState<CronJobRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [runningKey, setRunningKey] = useState<string | null>(null);
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const { confirm } = useConfirm();

    const fetchJobs = useCallback(async () => {
        try {
            const res = await fetch("/api/v1/admin/cron");
            if (!res.ok) {
                toast.error(t("cron_loadFailed"));
                return;
            }
            const data = await res.json();
            setJobs(data.jobs || []);
        } catch {
            toast.error(t("cron_loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void fetchJobs();
        const interval = setInterval(() => { void fetchJobs(); }, 10_000);
        return () => clearInterval(interval);
    }, [fetchJobs]);

    const handleRunNow = async (job: CronJobRow) => {
        const ok = await confirm({
            title: t("cron_runJobTitle"),
            message: t("cron_runJobMessage", { key: job.key }),
            confirmText: t("cron_runJobConfirm"),
        });
        if (!ok) return;

        setRunningKey(job.key);
        try {
            const res = await fetch(`/api/v1/admin/cron/${encodeURIComponent(job.key)}/run`, {
                method: "POST",
            });
            if (res.ok) {
                toast.success(t("cron_ranJob", { key: job.key }));
                void fetchJobs();
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(errorMessage(data, t("cron_runFailed"), t));
            }
        } catch {
            toast.error(t("cron_runFailed"));
        } finally {
            setRunningKey(null);
        }
    };

    return (
        <>
            <AdminPageHeader
                title={t("cron_title")}
                description={t("cron_description")}
                actions={<>
                    <Button variant="outline" onClick={() => void fetchJobs()} disabled={loading}>
                        <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                        {t("common_refresh")}
                    </Button>
                </>}
            />

            {loading && jobs.length === 0 ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
            ) : jobs.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        {t("cron_noCronJobs")}
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardContent className="p-0 overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-3 font-medium">{t("cron_jobKey")}</th>
                                    <th className="px-4 py-3 font-medium">{t("cron_schedule")}</th>
                                    <th className="px-4 py-3 font-medium">{t("cron_lastRun")}</th>
                                    <th className="px-4 py-3 font-medium">{t("common_status")}</th>
                                    <th className="px-4 py-3 font-medium">{t("cron_duration")}</th>
                                    <th className="px-4 py-3 font-medium">{t("cron_nextRun")}</th>
                                    <th className="px-4 py-3 font-medium text-right">{t("common_actions")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {jobs.map((job) => {
                                    const isExpanded = expandedKey === job.key;
                                    const hasError = job.lastStatus === "error" && job.lastError;
                                    return (
                                        <Fragment key={job.key}>
                                            <tr className="border-t border-border">
                                                <td className="px-4 py-3 font-mono text-xs">{job.key}</td>
                                                <td className="px-4 py-3 text-muted-foreground">{scheduleName(job.schedule)}</td>
                                                <td className="px-4 py-3 text-muted-foreground">{job.lastRunAt ? formatDateTime(job.lastRunAt) : "-"}</td>
                                                <td className="px-4 py-3">
                                                    {job.lastStatus ? (
                                                        <Badge
                                                            tone={STATUS_TONE[job.lastStatus] ?? "neutral"}
                                                            title={hasError ? job.lastError ?? "" : undefined}
                                                        >
                                                            {statusName(job.lastStatus)}
                                                        </Badge>
                                                    ) : (
                                                        <span className="text-muted-foreground">-</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-muted-foreground">{formatDuration(job.lastRunMs)}</td>
                                                <td className="px-4 py-3 text-muted-foreground">{job.nextRunAt ? formatDateTime(job.nextRunAt) : "-"}</td>
                                                <td className="px-4 py-3 text-right">
                                                    <div className="flex justify-end gap-1">
                                                        {hasError && (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => setExpandedKey(isExpanded ? null : job.key)}
                                                            >
                                                                {isExpanded ? t("cron_hide") : t("cron_error")}
                                                            </Button>
                                                        )}
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleRunNow(job)}
                                                            disabled={runningKey === job.key}
                                                        >
                                                            {runningKey === job.key ? (
                                                                <Loader2 className="w-3 h-3 animate-spin" />
                                                            ) : (
                                                                <Play className="w-3 h-3" />
                                                            )}
                                                            {t("cron_runNow")}
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && hasError && (
                                                <tr className="border-t border-border bg-muted/20">
                                                    <td colSpan={7} className="px-4 py-3">
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
                    </CardContent>
                </Card>
            )}
        </>
    );
}
