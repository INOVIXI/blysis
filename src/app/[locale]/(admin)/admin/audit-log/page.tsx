"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/core/lib/i18n/navigation";
import { Card, CardContent } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Pagination } from "@/core/components/ui/pagination";
import { Input } from "@/core/components/ui/input";
import { downloadFromUrl } from "@/core/lib/download";
import {
    Download,
    Loader2,
    Filter as FilterIcon,
    ChevronDown,
    ChevronUp,
} from "lucide-react";
import { userProfilePath } from "@/core/lib/user-profile-link";
import { useAllModules } from "@/core/providers/module-provider";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { NativeSelect } from "@/core/components/ui/native-select";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { useLocalDateTime } from "@/core/hooks/useLocalDate";

interface AuditLogEntry {
    id: string;
    action: string;
    entity: string | null;
    entityId: string | null;
    metadata: unknown;
    ipAddress: string | null;
    createdAt: string;
    user: { id: string; username: string } | null;
}

interface AuditLogResponse {
    logs: AuditLogEntry[];
    total: number;
    page: number;
    pages: number;
    actions: string[];
}

type ActionColor = {
    bg: string;
    text: string;
    border: string;
    label: string;
};

function classifyAction(action: string): ActionColor {
    // Highest sensitivity - purple
    if (
        action.startsWith("backup.") ||
        action.endsWith(".restore") ||
        action.startsWith("user.role.")
    ) {
        return {
            bg: "bg-secondary/10",
            text: "text-secondary",
            border: "border-secondary/40",
            label: "sensitive",
        };
    }
    if (action.endsWith(".install") || action.endsWith(".activate")) {
        return {
            bg: "bg-primary/10",
            text: "text-primary",
            border: "border-primary/40",
            label: "install",
        };
    }
    if (
        action.endsWith(".delete") ||
        action.endsWith(".revoke") ||
        action.endsWith(".uninstall")
    ) {
        return {
            bg: "bg-destructive/10",
            text: "text-destructive",
            border: "border-destructive/40",
            label: "destructive",
        };
    }
    if (action.endsWith(".create")) {
        return {
            bg: "bg-success/10",
            text: "text-success",
            border: "border-success/40",
            label: "create",
        };
    }
    if (action.endsWith(".update")) {
        return {
            bg: "bg-primary/10",
            text: "text-primary",
            border: "border-primary/40",
            label: "update",
        };
    }
    return {
        bg: "bg-muted",
        text: "text-muted-foreground",
        border: "border-border",
        label: "other",
    };
}

function truncate(str: string, max = 80): string {
    return str.length > max ? str.slice(0, max) + "…" : str;
}

function MetadataCell({ metadata }: { metadata: unknown }) {
    const [expanded, setExpanded] = useState(false);
    if (metadata == null || metadata === "") {
        return <span className="text-muted-foreground">-</span>;
    }
    const json = JSON.stringify(metadata, null, 2);
    const single = JSON.stringify(metadata);
    return (
        <div>
            <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="flex items-start gap-1 text-left text-xs text-muted-foreground hover:text-foreground"
            >
                {expanded ? (
                    <ChevronUp className="w-3 h-3 mt-0.5 shrink-0" />
                ) : (
                    <ChevronDown className="w-3 h-3 mt-0.5 shrink-0" />
                )}
                <code className="break-all">
                    {expanded ? null : truncate(single, 60)}
                </code>
            </button>
            {expanded && (
                <pre className="mt-1 max-w-md overflow-x-auto rounded bg-muted p-2 text-xs">
                    {json}
                </pre>
            )}
        </div>
    );
}

export default function AuditLogPage() {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDateTime = useLocalDateTime();
    const t = useTranslations("admin");
    const modules = useAllModules();
    const [failed, setFailed] = useState(false);

    const [logs, setLogs] = useState<AuditLogEntry[]>([]);
    const [actions, setActions] = useState<string[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [loading, setLoading] = useState(true);

    const [actionFilter, setActionFilter] = useState("");
    const [userFilter, setUserFilter] = useState("");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");

    const queryString = useMemo(() => {
        const sp = new URLSearchParams();
        sp.set("page", String(page));
        sp.set("limit", "50");
        if (actionFilter) sp.set("action", actionFilter);
        if (userFilter) sp.set("userId", userFilter);
        if (fromDate) sp.set("from", fromDate);
        if (toDate) sp.set("to", toDate);
        return sp.toString();
    }, [page, actionFilter, userFilter, fromDate, toDate]);

    const fetchLogs = useCallback(() => {
        setLoading(true);
        fetch(`/api/v1/admin/audit-log?${queryString}`)
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d: AuditLogResponse) => {
                setLogs(d.logs || []);
                setTotal(d.total || 0);
                setPages(d.pages || 1);
                setActions(d.actions || []);
                setFailed(false);
                setLoading(false);
            })
            .catch(() => { setFailed(true); setLoading(false); });
    }, [queryString]);

     
    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    const exportCsv = () => {
        const sp = new URLSearchParams(queryString);
        sp.set("export", "csv");
        sp.delete("page");
        sp.delete("limit");
        downloadFromUrl(`/api/v1/admin/audit-log?${sp.toString()}`, "audit-log.csv");
    };

    const resetPageAndSet = <T,>(setter: (v: T) => void) => (v: T) => {
        setPage(1);
        setter(v);
    };

    const title = t("auditLog_title");
    const subtitle = t("auditLog_subtitle");

    return (
        <div className="space-y-6">
            <AdminPageHeader
                title={title}
                description={subtitle}
                actions={<>
                    <Button variant="outline" size="sm" onClick={exportCsv}>
                        <Download className="w-4 h-4" />
                        {t("auditLog_exportCsv")}
                    </Button>
                </>}
            />

            <Card>
                <CardContent className="p-4">
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground flex items-center gap-1">
                                <FilterIcon className="w-3 h-3" />
                                {t("auditLog_actionKey")}
                            </label>
                            <NativeSelect
                                aria-label={t("auditLog_actionKey")}
                                value={actionFilter}
                                onChange={(e) =>
                                    resetPageAndSet(setActionFilter)(e.target.value)
                                } className="min-w-48" inputSize="sm"
                            >
                                <option value="">
                                    {t("auditLog_allActions")}
                                </option>
                                {actions.map((a) => (
                                    <option key={a} value={a}>
                                        {a}
                                    </option>
                                ))}
                            </NativeSelect>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground">
                                {t("auditLog_userId")}
                            </label>
                            <Input
                                aria-label={t("auditLog_userId")}
                                value={userFilter}
                                onChange={(e) =>
                                    resetPageAndSet(setUserFilter)(e.target.value)
                                }
                                placeholder="cuid..."
                                className="h-9 w-52"
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground">
                                {t("auditLog_from")}
                            </label>
                            <Input
                                aria-label={t("auditLog_from")}
                                type="date"
                                value={fromDate}
                                onChange={(e) =>
                                    resetPageAndSet(setFromDate)(e.target.value)
                                }
                                className="h-9 w-40"
                            />
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground">
                                {t("auditLog_to")}
                            </label>
                            <Input
                                aria-label={t("auditLog_to")}
                                type="date"
                                value={toDate}
                                onChange={(e) =>
                                    resetPageAndSet(setToDate)(e.target.value)
                                }
                                className="h-9 w-40"
                            />
                        </div>

                        {(actionFilter || userFilter || fromDate || toDate) && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setActionFilter("");
                                    setUserFilter("");
                                    setFromDate("");
                                    setToDate("");
                                    setPage(1);
                                }}
                            >
                                {t("auditLog_clear")}
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : failed ? (
                        <LoadFailed onRetry={fetchLogs} />
                    ) : logs.length === 0 ? (
                        <p className="text-muted-foreground text-center py-12">
                            {t("auditLog_noLogs")}
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b bg-muted/30">
                                        <th className="text-left py-2 px-4 font-medium text-xs text-muted-foreground">
                                            {t("auditLog_timestamp")}
                                        </th>
                                        <th className="text-left py-2 px-4 font-medium text-xs text-muted-foreground">
                                            {t("auditLog_user")}
                                        </th>
                                        <th className="text-left py-2 px-4 font-medium text-xs text-muted-foreground">
                                            {t("auditLog_actionKey")}
                                        </th>
                                        <th className="text-left py-2 px-4 font-medium text-xs text-muted-foreground">
                                            {t("auditLog_target")}
                                        </th>
                                        <th className="text-left py-2 px-4 font-medium text-xs text-muted-foreground">
                                            {t("auditLog_metadata")}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((log) => {
                                        const color = classifyAction(log.action);
                                        const profilePath = userProfilePath(log.user?.username, modules);
                                        return (
                                            <tr
                                                key={log.id}
                                                className="border-b last:border-0 hover:bg-muted/30"
                                            >
                                                <td className="py-2 px-4 whitespace-nowrap text-xs text-muted-foreground">
                                                    {formatDateTime(log.createdAt)}
                                                </td>
                                                <td className="py-2 px-4 whitespace-nowrap">
                                                    {log.user ? (
                                                        profilePath ? (
                                                            <Link
                                                                href={profilePath}
                                                                className="text-primary hover:underline"
                                                            >
                                                                {log.user.username}
                                                            </Link>
                                                        ) : (
                                                            <span>{log.user.username}</span>
                                                        )
                                                    ) : (
                                                        <span className="text-muted-foreground italic">
                                                            system
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="py-2 px-4 whitespace-nowrap">
                                                    <span
                                                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono ${color.bg} ${color.text} ${color.border}`}
                                                    >
                                                        {log.action}
                                                    </span>
                                                </td>
                                                <td className="py-2 px-4 text-xs text-muted-foreground">
                                                    {log.entity ? (
                                                        <code className="text-xs">
                                                            {log.entity}
                                                            {log.entityId
                                                                ? `/${log.entityId}`
                                                                : ""}
                                                        </code>
                                                    ) : (
                                                        "-"
                                                    )}
                                                </td>
                                                <td className="py-2 px-4 align-top">
                                                    <MetadataCell metadata={log.metadata} />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <div className="flex items-center justify-between p-4 border-t">
                        <span className="text-sm text-muted-foreground">
                            {total}{" "}
                            {t("auditLog_entries")}
                        </span>
                    </div>
                    <Pagination page={page} pages={pages} onPageChange={setPage} />
                </CardContent>
            </Card>
        </div>
    );
}
