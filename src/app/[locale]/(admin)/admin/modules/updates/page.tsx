"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Loader2, Download, Check, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { moduleDescription, moduleName } from "../module-name";
import { Badge } from "@/core/components/ui/badge";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { errorMessage } from "@/core/lib/write-result";
import { useLocalDateTime } from "@/core/hooks/useLocalDate";

interface UpdateInfo {
    moduleId: string;
    name: string;
    installedVersion: string;
    latestVersion: string;
    description?: string;
}

export default function ModuleUpdatesPage() {
    const __locale = useLocale();
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDateTime = useLocalDateTime();
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    const [updates, setUpdates] = useState<UpdateInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState<Set<string>>(new Set());
    const [updated, setUpdated] = useState<Set<string>>(new Set());
    const [checkedAt, setCheckedAt] = useState<string | null>(null);

    const fetchUpdates = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/v1/modules/updates");
            const data = await res.json();
            if (!res.ok) {
                setError(errorMessage(data, t("moduleUpdates_checkFailed"), t));
                return;
            }
            setUpdates(data.updates || []);
            setCheckedAt(data.checkedAt || null);
        } catch {
            setError(t("moduleUpdates_networkError"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => { fetchUpdates(); }, [fetchUpdates]);

    const updateModule = async (moduleId: string) => {
        setUpdating((s) => new Set(s).add(moduleId));
        try {
            const res = await fetch("/api/v1/modules/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ moduleId }),
            });
            if (res.ok) {
                toast.success(
                    t("moduleUpdates_updatedToast", { name: moduleId }),
                );
                setUpdated((s) => new Set(s).add(moduleId));
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(errorMessage(data, t("moduleUpdates_updateFailed"), t));
            }
        } catch {
            toast.error(t("moduleUpdates_networkError"));
        } finally {
            setUpdating((s) => {
                const next = new Set(s);
                next.delete(moduleId);
                return next;
            });
        }
    };

    if (loading) {
        return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
    }

    return (
        <>
            <AdminPageHeader
                title={t("moduleUpdates_title")}
                description={<>
                    {updates.length === 0
                        ? (t("moduleUpdates_allUpToDate"))
                        : (t("moduleUpdates_count", { count: updates.length }))}
                    {checkedAt && (
                        <span className="ml-2 text-xs">
                            · {t("moduleUpdates_checkedAt", { date: formatDateTime(checkedAt) })}
                        </span>
                    )}
                </>}
                backHref="/admin/modules"
                backLabel={commonT("back")}
                actions={
                    <Button variant="outline" onClick={fetchUpdates}>
                        <RefreshCw className="w-4 h-4" /> {t("moduleUpdates_recheck")}
                    </Button>
                }
            />

            {error && (
                <Card role="alert" className="mb-4 border-destructive">
                    <CardContent className="py-3 flex items-center gap-2 text-sm text-destructive">
                        <AlertCircle className="w-4 h-4" />
                        {error}
                    </CardContent>
                </Card>
            )}

            {updates.length === 0 && !error ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <Check className="w-12 h-12 text-success mx-auto mb-3" />
                        <p className="text-muted-foreground">{t("moduleUpdates_allUpToDate")}</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {updates.map((u) => {
                        const isUpdating = updating.has(u.moduleId);
                        const isDone = updated.has(u.moduleId);
                        return (
                            <Card key={u.moduleId}>
                                <CardHeader className="pb-3">
                                    <CardTitle className="flex items-center justify-between text-base">
                                        <span>{moduleName({ id: u.moduleId, name: u.name, description: u.description ?? "" }, __locale, t)}</span>
                                        <code className="text-xs font-mono text-muted-foreground">{u.moduleId}</code>
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 text-sm mb-2">
                                                <span className="px-2 py-0.5 bg-muted rounded text-xs font-mono">{u.installedVersion}</span>
                                                <span className="text-muted-foreground">→</span>
                                                <Badge tone="success" className="font-mono font-bold">{u.latestVersion}</Badge>
                                            </div>
                                            {u.description && (
                                                <p className="text-xs text-muted-foreground">{moduleDescription({ id: u.moduleId, name: u.name, description: u.description ?? "" }, __locale, t)}</p>
                                            )}
                                        </div>
                                        <Button
                                            onClick={() => updateModule(u.moduleId)}
                                            disabled={isUpdating || isDone}
                                            size="sm"
                                        >
                                            {isUpdating ? (
                                                <><Loader2 className="w-3 h-3 animate-spin" /> {t("moduleUpdates_updating")}</>
                                            ) : isDone ? (
                                                <><Check className="w-3 h-3" /> {t("moduleUpdates_done")}</>
                                            ) : (
                                                <><Download className="w-3 h-3" /> {t("moduleUpdates_update")}</>
                                            )}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </>
    );
}
