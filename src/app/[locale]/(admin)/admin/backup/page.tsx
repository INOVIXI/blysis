"use client";

import { useCallback, useEffect, useState } from "react";
import { useModalDialog } from "@/core/hooks/useModalDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { CheckboxField } from "@/core/components/ui/checkbox";
import { NativeSelect } from "@/core/components/ui/native-select";
import { Label } from "@/core/components/ui/label";
import { SCHEDULE_NAME_KEY } from "@/core/lib/cron-schedules";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { ListControls } from "@/core/components/ui/list-controls";
import { Pagination } from "@/core/components/ui/pagination";
import { useRowList } from "@/core/hooks/useRowList";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { downloadFromUrl } from "@/core/lib/download";
import { Badge } from "@/core/components/ui/badge";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { errorMessage } from "@/core/lib/write-result";
import { Database, Download, Trash2, RotateCcw, Loader2, RefreshCw, Plus, AlertTriangle } from "lucide-react";
import { useLocalDateTime } from "@/core/hooks/useLocalDate";

interface BackupRow {
    id: string;
    filename: string;
    type: "manual" | "scheduled";
    sizeBytes: number;
    sizeHuman: string;
    createdAt: string;
    notes: string | null;
}

interface CronRow {
    key: string;
    schedule: string;
    lastRunAt: string | null;
    nextRunAt: string | null;
}

function formatBytes(bytes: number): string {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function TypeBadge({ type, label }: { type: "manual" | "scheduled"; label: string }) {
    return (
        <Badge tone={type === "manual" ? "info" : "success"} className="uppercase font-mono">
            {label}
        </Badge>
    );
}

export default function BackupAdminPage() {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDateTime = useLocalDateTime();
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    const [backups, setBackups] = useState<BackupRow[]>([]);
    // The filename and whatever was noted beside it. A site backing up nightly
    // has a year of rows within a year, and the only reason to open this list
    // is to find the one from before something went wrong.
    const list = useRowList(backups, { text: (row) => [row.filename, row.notes], pageSize: 20 });
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    /*
     * Whether a backup can be taken here at all, asked before one is.
     * `pg_dump` fails in two quiet ways - it is not installed, or it is older
     * than the server it would dump - and both are found out from a red row
     * on the jobs screen a day later, or at the moment a backup was wanted.
     */
    const [tools, setTools] = useState<{ ok: boolean; reason: string | null; clientMajor: number | null; serverMajor: number | null } | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [restoringId, setRestoringId] = useState<string | null>(null);
    const [automated, setAutomated] = useState(true);
    /*
     * How often, and how many to keep. Both used to be written into the
     * source beside the job - `every-day` at the registration and a constant
     * in `backup.ts` - so a shop taking orders all day could not ask for an
     * hourly dump and a host with 20 GB free could not keep fewer than
     * thirty. The cadences on offer come with the answer rather than being
     * listed again here: core owns that list.
     */
    const [schedule, setSchedule] = useState("every-day");
    const [keep, setKeep] = useState(30);
    const [schedules, setSchedules] = useState<string[]>([]);
    const [savingSchedule, setSavingSchedule] = useState(false);
    const [nextScheduled, setNextScheduled] = useState<string | null>(null);
    const [lastScheduled, setLastScheduled] = useState<string | null>(null);
    const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null);
    const [restoreText, setRestoreText] = useState("");
    const { confirm } = useConfirm();

    const fetchBackups = useCallback(async () => {
        try {
            const res = await fetch("/api/v1/admin/backup");
            if (!res.ok) {
                toast.error(t("backup_loadFailed"));
                return;
            }
            const data = await res.json();
            setBackups(data.backups || []);
            setAutomated(data.automated?.enabled !== false);
            if (typeof data.automated?.schedule === "string") setSchedule(data.automated.schedule);
            if (typeof data.automated?.keep === "number") setKeep(data.automated.keep);
            if (Array.isArray(data.schedules)) setSchedules(data.schedules);
            if (data.tools && typeof data.tools === "object") setTools(data.tools);
        } catch {
            toast.error(t("backup_loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    const fetchCronInfo = useCallback(async () => {
        try {
            const res = await fetch("/api/v1/admin/cron");
            if (!res.ok) return;
            const data = await res.json();
            const job = (data.jobs as CronRow[] | undefined)?.find((j) => j.key === "core:automated-backup");
            if (job) {
                setNextScheduled(job.nextRunAt);
                setLastScheduled(job.lastRunAt);
            }
        } catch {
            // non-fatal
        }
    }, []);

    useEffect(() => {
        void fetchBackups();
        void fetchCronInfo();
    }, [fetchBackups, fetchCronInfo]);

    const lastBackupAt = backups.length > 0 ? backups[0].createdAt : null;

    /**
     * One writer for the three controls.
     *
     * Each control moves first and is put back on any answer that is not a
     * yes, so nothing lags behind a click - and a refusal, which is what a
     * cadence core does not offer gets, leaves the screen showing what is
     * really stored rather than what was asked for.
     */
    const saveSchedule = async (
        patch: { automated?: boolean; schedule?: string; keep?: number },
        undo: () => void,
        announce: string,
    ) => {
        setSavingSchedule(true);
        try {
            const res = await fetch("/api/v1/admin/backup", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
            });
            if (!res.ok) {
                undo();
                const data = await res.json().catch(() => null);
                toast.error(errorMessage(data, t("backup_scheduleFailed"), t));
                return;
            }
            toast.success(announce);
            void fetchCronInfo();
        } catch {
            undo();
            toast.error(t("backup_scheduleFailed"));
        } finally {
            setSavingSchedule(false);
        }
    };

    const toggleAutomated = async (next: boolean) => {
        const previous = automated;
        setAutomated(next);
        await saveSchedule(
            { automated: next },
            () => setAutomated(previous),
            next ? t("backup_scheduleOn") : t("backup_scheduleOff"),
        );
    };

    const chooseSchedule = async (next: string) => {
        const previous = schedule;
        setSchedule(next);
        await saveSchedule({ schedule: next }, () => setSchedule(previous), t("backup_scheduleSaved"));
    };

    const chooseKeep = async (next: number) => {
        const previous = keep;
        setKeep(next);
        await saveSchedule({ keep: next }, () => setKeep(previous), t("backup_scheduleSaved"));
    };


    const handleCreate = async () => {
        setCreating(true);
        try {
            const res = await fetch("/api/v1/admin/backup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(t("backup_createdToast", { size: data.backup?.sizeHuman ?? "" }));
                await fetchBackups();
            } else {
                toast.error(errorMessage(data, t("backup_backupFailed"), t));
            }
        } catch {
            toast.error(t("backup_backupFailed"));
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (row: BackupRow) => {
        const ok = await confirm({
            title: t("backup_deleteTitle"),
            message: t("backup_deleteConfirm", { filename: row.filename }),
            variant: "danger",
            confirmText: t("common_delete"),
        });
        if (!ok) return;
        setDeletingId(row.id);
        try {
            const res = await fetch(`/api/v1/admin/backup/${encodeURIComponent(row.id)}`, { method: "DELETE" });
            if (res.ok) {
                toast.success(t("backup_deleted"));
                await fetchBackups();
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(errorMessage(data, t("backup_deleteFailed"), t));
            }
        } catch {
            toast.error(t("backup_deleteFailed"));
        } finally {
            setDeletingId(null);
        }
    };

    const handleDownload = (row: BackupRow) => {
        downloadFromUrl(`/api/v1/admin/backup/${encodeURIComponent(row.id)}/download`);
    };

    const openRestoreDialog = (row: BackupRow) => {
        setRestoreTarget(row);
        setRestoreText("");
    };

    // Restoring a backup overwrites the live database, so the dialog that asks
    // for it had better be closeable without a mouse.
    const restoreDialogRef = useModalDialog<HTMLDivElement>(restoreTarget !== null, () =>
        closeRestoreDialog(),
    );

    const closeRestoreDialog = () => {
        setRestoreTarget(null);
        setRestoreText("");
    };

    const handleRestore = async () => {
        if (!restoreTarget || restoreText !== "RESTORE") return;
        const target = restoreTarget;
        setRestoringId(target.id);
        closeRestoreDialog();
        try {
            const res = await fetch(`/api/v1/admin/backup/${encodeURIComponent(target.id)}/restore`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ confirmText: "RESTORE" }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.success(t("backup_restored"));
            } else {
                toast.error(errorMessage(data, t("backup_restoreFailed"), t));
            }
        } catch {
            toast.error(t("backup_restoreFailed"));
        } finally {
            setRestoringId(null);
            await fetchBackups();
        }
    };

    return (
        <>
            <AdminPageHeader
                title={t("sidebar_backup")}
                description={t("backup_description")}
                actions={<>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => { void fetchBackups(); void fetchCronInfo(); }} disabled={loading}>
                            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                            {t("common_refresh")}
                        </Button>
                        {/* Not offered where it cannot work: a button that
                            answers with the same error every time is a button
                            that teaches an operator to distrust the screen. */}
                        <Button onClick={handleCreate} disabled={creating || tools?.ok === false}>
                            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            {t("backup_createNow")}
                        </Button>
                    </div>
                </>}
            />

            {/* Above the numbers, because none of them mean anything on a
                server that cannot take a backup. */}
            {tools && !tools.ok && (
                <Card className="mb-6 border-destructive/40">
                    <CardContent className="p-4 flex gap-3">
                        <AlertTriangle className="w-5 h-5 text-destructive shrink-0" aria-hidden="true" />
                        <div>
                            <p className="font-medium">{t("backup_cannotTitle")}</p>
                            <p className="text-sm text-muted-foreground mt-1">
                                {tools.reason === "too_old"
                                    ? t("backup_cannotTooOld", {
                                        client: tools.clientMajor ?? 0,
                                        server: tools.serverMajor ?? 0,
                                    })
                                    : t("backup_cannotMissing")}
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <Card>
                    <CardHeader className="p-4">
                        <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">{t("backup_totalBackups")}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-2xl font-bold">{backups.length}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="p-4">
                        <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">{t("backup_lastBackup")}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-sm font-medium">{lastBackupAt ? formatDateTime(lastBackupAt) : "-"}</div>
                        {lastScheduled && (
                            <div className="text-xs text-muted-foreground mt-1">{t("backup_lastScheduled")}: {lastScheduled ? formatDateTime(lastScheduled) : "-"}</div>
                        )}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="p-4">
                        <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">{t("backup_nextScheduled")}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0 space-y-3">
                        <div>
                            <div className="text-sm font-medium">
                                {automated ? nextScheduled ? formatDateTime(nextScheduled) : "-" : t("backup_scheduleOffLabel")}
                            </div>
                            {/* The cadence that is really set, not the word
                                "daily": this card said "runs daily" whatever
                                the job was on. */}
                            <div className="text-xs text-muted-foreground mt-1">
                                {automated
                                    ? t("backup_runsOn", { schedule: t(SCHEDULE_NAME_KEY[schedule as keyof typeof SCHEDULE_NAME_KEY] ?? "cron_everyDay") })
                                    : t("backup_scheduleOffHint")}
                            </div>
                        </div>
                        <CheckboxField
                            checked={automated}
                            disabled={savingSchedule}
                            onChange={(e) => void toggleAutomated(e.target.checked)}
                            label={<span className="text-xs">{t("backup_automatedLabel")}</span>}
                        />
                    </CardContent>
                </Card>
            </div>

            {/* How often, and how many to keep. Both were constants in the
                source until now, so this card is the whole of what an
                operator could not say. It is greyed rather than hidden when
                the job is off: the settings still stand, and hiding them
                makes switching back on look like it forgets them. */}
            <Card className="mb-6">
                <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-sm">{t("backup_scheduleTitle")}</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-2 space-y-2">
                    <div className="flex flex-wrap items-start gap-4">
                    <div className="w-56">
                        <Label htmlFor="backup-schedule">{t("backup_scheduleLabel")}</Label>
                        <NativeSelect
                            id="backup-schedule"
                            value={schedule}
                            disabled={savingSchedule || !automated}
                            onChange={(e) => void chooseSchedule(e.target.value)}
                            className="w-full"
                            inputSize="sm"
                        >
                            {schedules.map((one) => (
                                <option key={one} value={one}>
                                    {t(SCHEDULE_NAME_KEY[one as keyof typeof SCHEDULE_NAME_KEY] ?? "cron_everyDay")}
                                </option>
                            ))}
                        </NativeSelect>
                    </div>
                    <div className="w-32">
                        <Label htmlFor="backup-keep">{t("backup_keepLabel")}</Label>
                        <Input
                            id="backup-keep"
                            type="number"
                            min={1}
                            max={365}
                            value={keep}
                            disabled={savingSchedule || !automated}
                            onChange={(e) => setKeep(Number(e.target.value))}
                            // Written when the box is left rather than on every
                            // keystroke: typing "12" over "30" passes through
                            // "1", and a backup count is not a thing to save
                            // halfway through.
                            onBlur={(e) => {
                                const asked = Number(e.target.value);
                                if (Number.isInteger(asked) && asked >= 1 && asked <= 365) void chooseKeep(asked);
                            }}
                        />
                    </div>
                    </div>
                    {/* Under the row rather than under one box: a hint below a
                        single control stretches that column and leaves the one
                        beside it floating at a different height. */}
                    <p className="text-xs text-muted-foreground">{t("backup_keepHint")}</p>
                </CardContent>
            </Card>

            <ListControls className="mb-4" search={{ value: list.search, onChange: list.setSearch }} />

            {loading && backups.length === 0 ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
            ) : list.rows.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <Database className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                        <p className="text-sm text-muted-foreground">
                            {list.search.trim() === "" ? t("backup_noBackups") : commonT("noResults")}
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardContent className="p-0 overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-3 font-medium">{t("backup_filename")}</th>
                                    <th className="px-4 py-3 font-medium">{t("backup_type")}</th>
                                    <th className="px-4 py-3 font-medium">{t("backup_size")}</th>
                                    <th className="px-4 py-3 font-medium">{t("backup_created")}</th>
                                    <th className="px-4 py-3 font-medium text-right">{t("backup_actions")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {list.rows.map((row) => (
                                    <tr key={row.id} className="border-t border-border">
                                        <td className="px-4 py-3 font-mono text-xs break-all">{row.filename}</td>
                                        <td className="px-4 py-3"><TypeBadge type={row.type} label={row.type === "manual" ? t("backup_manual") : t("backup_scheduled")} /></td>
                                        <td className="px-4 py-3 text-muted-foreground">{row.sizeHuman || formatBytes(row.sizeBytes)}</td>
                                        <td className="px-4 py-3 text-muted-foreground">{row.createdAt ? formatDateTime(row.createdAt) : "-"}</td>
                                        <td className="px-4 py-3">
                                            <div className="flex justify-end gap-1">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleDownload(row)}
                                                    title={t("backup_download")}
                                                >
                                                    <Download className="w-3 h-3" />
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => openRestoreDialog(row)}
                                                    disabled={restoringId === row.id}
                                                    title={t("backup_restore")}
                                                >
                                                    {restoringId === row.id
                                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                                        : <RotateCcw className="w-3 h-3" />}
                                                </Button>
                                                <Button
                                                    variant="destructive"
                                                    size="sm"
                                                    onClick={() => handleDelete(row)}
                                                    disabled={deletingId === row.id}
                                                    title={t("common_delete")}
                                                >
                                                    {deletingId === row.id
                                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                                        : <Trash2 className="w-3 h-3" />}
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <Pagination
                            page={list.page}
                            pages={list.pages}
                            total={list.total}
                            onPageChange={list.setPage}
                        />
                    </CardContent>
                </Card>
            )}

            {restoreTarget && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center" role="presentation">
                    <div className="fixed inset-0 bg-black/60" onClick={closeRestoreDialog} aria-hidden="true" />
                    <div
                        ref={restoreDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="restore-title"
                        className="relative bg-card border border-[var(--blysis-color-border)] rounded-xl shadow-2xl p-6 w-full max-w-md mx-4"
                    >
                        <div className="flex items-start gap-4 mb-4">
                            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                                <AlertTriangle className="w-5 h-5 text-destructive" aria-hidden="true" />
                            </div>
                            <div className="flex-1">
                                <h2 id="restore-title" className="font-semibold text-foreground mb-1">{t("backup_restoreTitle")}</h2>
                                <p className="text-sm text-muted-foreground">
                                    {t("backup_restoreWarning")}
                                    {" "}<span className="font-mono text-xs break-all">{restoreTarget.filename}</span>.
                                </p>
                            </div>
                        </div>
                        <div className="mb-4">
                            <label htmlFor="restore-confirm" className="block text-xs text-muted-foreground mb-1">
                                {t("backup_restoreConfirmLabel")}
                            </label>
                            <Input
                                id="restore-confirm"
                                autoFocus
                                value={restoreText}
                                onChange={(e) => setRestoreText(e.target.value)}
                                placeholder="RESTORE"
                            />
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={closeRestoreDialog}>{t("common_cancel")}</Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={handleRestore}
                                disabled={restoreText !== "RESTORE"}
                            >
                                {t("backup_restoreTitle")}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
