"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/core/components/ui/card";
import { Button, buttonClassName } from "@/core/components/ui/button";
import { Pagination } from "@/core/components/ui/pagination";
import { ListControls } from "@/core/components/ui/list-controls";
import { useRowList } from "@/core/hooks/useRowList";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { Link } from "@/core/lib/i18n/navigation";
import { useTranslations } from "next-intl";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { useLocalDate, useLocalDateTime } from "@/core/hooks/useLocalDate";

interface IpBlock {
    id: string;
    ip: string;
    scope: string;
    reason: string | null;
    expiresAt: string | null;
    createdAt: string;
    createdById: string | null;
}

export default function IpBlocksPage() {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate();
    const formatDateTime = useLocalDateTime();
    const t = useTranslations("admin");
    const commonT = useTranslations("common");

    const [blocks, setBlocks] = useState<IpBlock[]>([]);
    // The address and the reason: the two the table draws that a reader would
    // recognise. A list of blocks grows every time somebody is refused.
    const list = useRowList(blocks, { text: (b) => [b.ip, b.reason], pageSize: 10 });
    const [loading, setLoading] = useState(true);


    const { confirm } = useConfirm();

    const fetchBlocks = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/v1/admin/ip-blocks");
            if (res.ok) {
                const data = await res.json();
                setBlocks(data.blocks || []);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchBlocks();
    }, [fetchBlocks]);

    const deleteBlock = async (b: IpBlock) => {
        const ok = await confirm({
            title: t("ipBlocks_removeTitle"),
            message: t("ipBlocks_removeConfirm"),
            variant: "danger",
        });
        if (!ok) return;
        const res = await fetch(`/api/v1/admin/ip-blocks/${b.id}`, { method: "DELETE" });
        if (res.ok) {
            toast.success(t("ipBlocks_removed"));
            fetchBlocks();
        } else {
            toast.error(t("ipBlocks_removeFailed"));
        }
    };

    const scopeLabel = (s: string): string => {
        if (s === "admin") return t("ipBlocks_scopeAdmin");
        if (s === "api") return t("ipBlocks_scopeApi");
        return t("ipBlocks_scopeAll");
    };

    return (
        <>
            <AdminPageHeader
                title={t("ipBlocks_title")}
                description={t("ipBlocks_subtitle")}
                actions={<>
                    <Link href="/admin/ip-blocks/new" className={buttonClassName("default", "default")}>
                            <Plus className="w-4 h-4" /> {t("ipBlocks_add")}
                        </Link>
                </>}
            />

            <ListControls className="mb-4" search={{ value: list.search, onChange: list.setSearch }} />

            <Card>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : blocks.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">
                            {t("ipBlocks_none")}
                        </p>
                    ) : list.rows.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">{commonT("noResults")}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="text-xs uppercase text-muted-foreground border-b">
                                    <tr>
                                        <th className="text-left p-3">{t("ipBlocks_colIp")}</th>
                                        <th className="text-left p-3">{t("ipBlocks_colScope")}</th>
                                        <th className="text-left p-3">{t("ipBlocks_colReason")}</th>
                                        <th className="text-left p-3">{t("ipBlocks_colExpires")}</th>
                                        <th className="text-left p-3">{t("ipBlocks_colCreated")}</th>
                                        <th className="text-right p-3">{t("ipBlocks_colActions")}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {list.rows.map((b) => {
                                        const expired = b.expiresAt && new Date(b.expiresAt).getTime() < Date.now();
                                        return (
                                            <tr key={b.id}>
                                                <td className="p-3 font-mono">{b.ip}</td>
                                                <td className="p-3">{scopeLabel(b.scope)}</td>
                                                <td className="p-3 text-muted-foreground max-w-xs truncate">
                                                    {b.reason || "-"}
                                                </td>
                                                <td className="p-3 text-muted-foreground">
                                                    {b.expiresAt ? (
                                                        <span className={expired ? "text-muted-foreground line-through" : ""}>
                                                            {formatDateTime(b.expiresAt)}
                                                        </span>
                                                    ) : (
                                                        t("ipBlocks_permanent")
                                                    )}
                                                </td>
                                                <td className="p-3 text-muted-foreground">
                                                    {formatDate(b.createdAt)}
                                                </td>
                                                <td className="p-3 text-right">
                                                    <Button
                                                        aria-label={commonT("delete")}
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-destructive"
                                                        onClick={() => deleteBlock(b)}
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </Button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <Pagination
                        page={list.page}
                        pages={list.pages}
                        total={list.total}
                        onPageChange={list.setPage}
                    />
                </CardContent>
            </Card>
        </>
    );
}
