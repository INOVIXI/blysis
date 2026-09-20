"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/core/components/ui/card";
import { Pagination } from "@/core/components/ui/pagination";
import { ListControls } from "@/core/components/ui/list-controls";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { useLocalDateTime } from "@/core/hooks/useLocalDate";

interface LogEntry {
    id: string;
    action: string;
    entity: string | null;
    entityId: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
    user: { id: string; username: string } | null;
}

export default function ActivityLogPage() {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDateTime = useLocalDateTime();
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [failed, setFailed] = useState(false);
    // Sent to the endpoint: this table only grows, and the twenty rows in the
    // browser are not the list.
    const [search, setSearch] = useState("");

    const fetchLogs = useCallback(() => {
        setLoading(true);
        const query = new URLSearchParams({ page: String(page) });
        if (search.trim()) query.set("q", search.trim());
        fetch(`/api/v1/activity-log?${query}`)
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d) => { setLogs(d.logs || []); setTotalPages(d.pages || 1); setFailed(false); setLoading(false); })
            .catch(() => { setFailed(true); setLoading(false); });
    }, [page, search]);

     
    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    return (
        <>
            <AdminPageHeader
                title={t("activityLog_title")}
                description={t("activityLog_subtitle")}
            />

            <ListControls
                className="mb-4"
                search={{ value: search, onChange: (term) => { setSearch(term); setPage(1); } }}
            />

            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    ) : failed ? (
                        <LoadFailed onRetry={fetchLogs} />
                    ) : logs.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">
                            {search.trim() === "" ? t("activityLog_noLogs") : commonT("noResults")}
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b">
                                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">{t("activityLog_user")}</th>
                                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">{t("activityLog_actionKey")}</th>
                                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">{t("activityLog_entity")}</th>
                                        <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">{t("activityLog_date")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((log) => (
                                        <tr key={log.id} className="border-b last:border-0 hover:bg-muted/50">
                                            <td className="py-3 px-4 text-sm">{log.user?.username || t("activityLog_system")}</td>
                                            <td className="py-3 px-4"><code className="text-xs bg-muted px-2 py-0.5 rounded">{log.action}</code></td>
                                            <td className="py-3 px-4 text-sm text-muted-foreground">{log.entity ? `${log.entity}/${log.entityId}` : "-"}</td>
                                            <td className="py-3 px-4 text-sm text-muted-foreground">{formatDateTime(log.createdAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <Pagination page={page} pages={totalPages} onPageChange={setPage} />
                </CardContent>
            </Card>
        </>
    );
}
