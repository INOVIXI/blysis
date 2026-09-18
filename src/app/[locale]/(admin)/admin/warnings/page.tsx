"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/core/components/ui/card";
import { Button, buttonClassName } from "@/core/components/ui/button";
import { Pagination } from "@/core/components/ui/pagination";
import { Plus, Loader2, ShieldOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { Link } from "@/core/lib/i18n/navigation";
import { useTranslations } from "next-intl";
import { badgeClassName } from "@/core/components/ui/badge";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { useLocalDate, useLocalDateTime } from "@/core/hooks/useLocalDate";

interface Warning {
    id: string;
    reason: string;
    points: number;
    expiresAt: string | null;
    isActive: boolean;
    createdAt: string;
    user: { id: string; username: string } | null;
    issuedBy: { id: string; username: string } | null;
}

export default function WarningsPage() {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate();
    const formatDateTime = useLocalDateTime();
    const t = useTranslations("admin");
    const commonT = useTranslations("common");

    const [warnings, setWarnings] = useState<Warning[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);


    const { confirm } = useConfirm();

    const fetchWarnings = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/v1/admin/warnings?page=${page}`);
            if (res.ok) {
                const data = await res.json();
                setWarnings(data.warnings || []);
                setPages(data.pages || 1);
                setTotal(data.total || 0);
            }
        } finally {
            setLoading(false);
        }
    }, [page]);

    useEffect(() => {
        fetchWarnings();
    }, [fetchWarnings]);

    const revoke = async (w: Warning) => {
        const ok = await confirm({
            title: t("warnings_revokeTitle"),
            message: t("warnings_revokeConfirm"),
            variant: "danger",
            confirmText: t("warnings_revoke"),
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/admin/warnings/${w.id}`, { method: "PATCH" });
        if (res.ok) {
            toast.success(t("warnings_revoked"));
            fetchWarnings();
        } else {
            toast.error(t("common_failed"));
        }
    };

    const deleteWarning = async (w: Warning) => {
        const ok = await confirm({
            title: t("warnings_deleteTitle"),
            message: t("warnings_deleteConfirm"),
            variant: "danger",
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/admin/warnings/${w.id}`, { method: "DELETE" });
        if (res.ok) {
            toast.success(t("warnings_deleted"));
            fetchWarnings();
        } else {
            toast.error(t("common_failed"));
        }
    };

    return (
        <>
            <AdminPageHeader
                title={t("warnings_title")}
                description={t("warnings_subtitle")}
                actions={<>
                    <Link href="/admin/warnings/new" className={buttonClassName("default", "default")}>
                            <Plus className="w-4 h-4" /> {t("warnings_issueButton")}
                        </Link>
                </>}
            />

            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : warnings.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">
                            {t("warnings_none")}
                        </p>
                    ) : (
                        <div className="divide-y">
                            {warnings.map((w) => (
                                <div key={w.id} className="p-4 flex items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-medium">
                                                {w.user?.username || "-"}
                                            </span>
                                            <span
                                                className={badgeClassName(w.isActive ? "danger" : "neutral", "uppercase font-mono")}
                                            >
                                                {w.isActive
                                                    ? t("warnings_active")
                                                    : t("warnings_inactive")}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {w.points} {t("warnings_pts")}
                                            </span>
                                        </div>
                                        <p className="text-sm text-muted-foreground truncate">
                                            {w.reason}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {t("warnings_by")}{" "}
                                            {w.issuedBy?.username || t("warnings_system")}{" "}
                                            · {formatDateTime(w.createdAt)}
                                            {w.expiresAt && (
                                                <>
                                                    {" "}
                                                    · {t("warnings_expires")}{" "}
                                                    {formatDate(w.expiresAt)}
                                                </>
                                            )}
                                        </p>
                                    </div>
                                    <div className="flex gap-1">
                                        {w.isActive && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => revoke(w)}
                                                title={t("warnings_revoke")}
                                            >
                                                <ShieldOff className="w-3 h-3" />
                                            </Button>
                                        )}
                                        <Button
                                            aria-label={commonT("delete")}
                                            variant="ghost"
                                            size="sm"
                                            className="text-destructive"
                                            onClick={() => deleteWarning(w)}
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />
                </CardContent>
            </Card>
        </>
    );
}
