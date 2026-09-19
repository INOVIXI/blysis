"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/core/components/ui/card";
import { Button, buttonClassName } from "@/core/components/ui/button";
import { Pagination } from "@/core/components/ui/pagination";
import { ListControls } from "@/core/components/ui/list-controls";
import { Checkbox } from "@/core/components/ui/checkbox";
import { BulkBar } from "@/core/components/admin/BulkBar";
import { useRowList } from "@/core/hooks/useRowList";
import { deleteEach } from "@/core/lib/bulk-delete";
import { Loader2, Plus, Trash2, Key } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { Link } from "@/core/lib/i18n/navigation";
import { writeError } from "@/core/lib/write-result";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { useLocalDate } from "@/core/hooks/useLocalDate";

interface ApiKeyItem {
    id: string;
    name: string;
    key: string;
    lastUsedAt: string | null;
    isActive: boolean;
    createdAt: string;
}

export default function ApiKeysPage() {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate();
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    const [keys, setKeys] = useState<ApiKeyItem[]>([]);
    // The endpoint stops at 500 rows and says when it did. Showing five
    // hundred with nothing to mark the edge is the silence the ceiling was
    // added to avoid.
    const [truncated, setTruncated] = useState(false);
    // A key list grows one integration at a time and nobody ever tidies it,
    // because tidying it was one confirmation per key.
    const list = useRowList(keys, { text: (k) => [k.name], pageSize: 10 });
    const [loading, setLoading] = useState(true);
    const { confirm } = useConfirm();

    const fetchKeys = useCallback(async () => {
        const res = await fetch("/api/v1/api-keys");
        if (res.ok) {
            const data = await res.json();
            setKeys(data.keys || []);
            setTruncated(Boolean(data.truncated));
        }
        setLoading(false);
    }, []);

     
    useEffect(() => { fetchKeys(); }, [fetchKeys]);

    const deleteMany = async () => {
        const ok = await confirm({
            title: t("apiKeys_deleteTitle"),
            message: t("crud_deleteItemsConfirm", { count: list.picked.size }),
            variant: "danger",
            confirmText: t("common_delete"),
        });
        if (!ok) return;
        const { deleted, total } = await deleteEach([...list.picked], async (id) => {
            const res = await fetch(`/api/v1/api-keys/${id}`, { method: "DELETE" });
            return res.ok;
        });
        list.clear();
        fetchKeys();
        if (deleted === total) toast.success(t("crud_deleted"));
        else if (deleted === 0) toast.error(t("crud_deleteFailed"));
        else toast.error(t("crud_deletedPartly", { deleted, total }));
    };

    const deleteKey = async (id: string) => {
        const ok = await confirm({ title: t("apiKeys_deleteTitle"), message: t("apiKeys_deleteMessage"), variant: "danger", confirmText: t("common_delete") });
        if (!ok) return;
        const res = await fetch(`/api/v1/api-keys/${id}`, { method: "DELETE" });
        const failed = await writeError(res, t("common_writeFailed"), t);
        if (failed) { toast.error(failed); return; }
        fetchKeys();
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;

    return (
        <>
            <AdminPageHeader
                title={t("apiKeys_title")}
                description={t("apiKeys_subtitle")}
                actions={<>
                    <Link href="/admin/api-keys/new" className={buttonClassName("default", "default")}>
                            <Plus className="w-4 h-4" /> {t("apiKeys_newKey")}
                        </Link>
                </>}
            />

            {truncated && (
                <p role="status" className="mb-4 text-sm text-muted-foreground">
                    {t("common_listTruncated")}
                </p>
            )}

            <ListControls className="mb-4" search={{ value: list.search, onChange: list.setSearch }} />

            <Card>
                <CardContent className="p-0">
                    {keys.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">{t("apiKeys_noKeys")}</p>
                    ) : (
                        <div className="divide-y">
                            <BulkBar
                                state={list.headerState}
                                count={list.picked.size}
                                onToggleAll={list.toggleAll}
                                actions={
                                    <Button variant="destructive" size="sm" onClick={deleteMany}>
                                        <Trash2 className="w-4 h-4" /> {commonT("delete")} {list.picked.size}
                                    </Button>
                                }
                            />
                            {list.rows.map((k) => (
                                <div key={k.id} className="flex items-center justify-between p-4">
                                    <div className="flex items-center gap-3">
                                        <Checkbox
                                            checked={list.picked.has(k.id)}
                                            onChange={() => list.toggle(k.id)}
                                            aria-label={t("common_selectRow")}
                                        />
                                        <Key className="w-4 h-4 text-muted-foreground" />
                                        <div>
                                            <p className="font-medium">{k.name}</p>
                                            <p className="text-xs text-muted-foreground font-mono">{k.key}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-xs text-muted-foreground">{formatDate(k.createdAt)}</span>
                                        <Button aria-label={commonT("delete")} variant="ghost" size="sm" className="text-destructive" onClick={() => deleteKey(k.id)}>
                                            <Trash2 className="w-3 h-3" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
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
