"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@/core/lib/i18n/navigation";
import { Card, CardContent } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Pagination } from "@/core/components/ui/pagination";
import {
    Check,
    X,
    Loader2,
    ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/core/components/ui/confirm-dialog";
import { useTranslations } from "next-intl";
import { writeError } from "@/core/lib/write-result";
import { Checkbox } from "@/core/components/ui/checkbox";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { FilterChips } from "@/core/components/admin/FilterChips";
import { BulkBar } from "@/core/components/admin/BulkBar";
import { Badge } from "@/core/components/ui/badge";
import { headerState } from "@/core/lib/bulk-selection";
import { useLocalDateTime } from "@/core/hooks/useLocalDate";

interface ModerationItem {
    id: string;
    type: string;
    author: { id: string; username: string } | null;
    preview: string;
    title?: string;
    createdAt: string;
    href?: string;
}

interface CountsPayload {
    counts: Record<string, number>;
    types: Record<string, { label: string; labelKey?: string }>;
}

interface ListPayload {
    items: ModerationItem[];
    total: number;
    page: number;
    pages: number;
}

export default function ModerationPage() {
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDateTime = useLocalDateTime();
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    const [types, setTypes] = useState<Record<string, { label: string; labelKey?: string }>>({});
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [activeTab, setActiveTab] = useState<string>("all");
    const [items, setItems] = useState<ModerationItem[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);

    const { confirm } = useConfirm();

    const typeIds = useMemo(() => Object.keys(types), [types]);

    const typeLabel = useCallback(
        (id: string): string => {
            const meta = types[id];
            if (!meta) return id;
            return meta.labelKey && t.has(meta.labelKey) ? t(meta.labelKey) : meta.label;
        },
        [types, t],
    );

    const fetchCounts = useCallback(async () => {
        const res = await fetch("/api/v1/admin/moderation");
        if (res.ok) {
            const data: CountsPayload = await res.json();
            setCounts(data.counts || {});
            setTypes(data.types || {});
        }
    }, []);

    const fetchItems = useCallback(async () => {
        if (typeIds.length === 0) {
            setItems([]);
            setTotal(0);
            setPages(1);
            setLoading(false);
            return;
        }
        setLoading(true);
        setSelected(new Set());
        try {
            if (activeTab === "all") {
                const results = await Promise.all(
                    typeIds.map((id) =>
                        fetch(`/api/v1/admin/moderation?type=${encodeURIComponent(id)}&page=1`).then(
                            (r) => (r.ok ? (r.json() as Promise<ListPayload>) : null),
                        ),
                    ),
                );
                const combined: ModerationItem[] = [];
                let sum = 0;
                for (const r of results) {
                    if (r) {
                        combined.push(...r.items);
                        sum += r.total;
                    }
                }
                combined.sort(
                    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                );
                setItems(combined);
                setTotal(sum);
                setPages(1);
                setPage(1);
            } else {
                const res = await fetch(
                    `/api/v1/admin/moderation?type=${encodeURIComponent(activeTab)}&page=${page}`,
                );
                if (res.ok) {
                    const data: ListPayload = await res.json();
                    setItems(data.items);
                    setTotal(data.total);
                    setPages(data.pages);
                }
            }
        } finally {
            setLoading(false);
        }
    }, [activeTab, page, typeIds]);

    useEffect(() => {
        fetchCounts();
    }, [fetchCounts]);

    useEffect(() => {
        fetchItems();
    }, [fetchItems]);

    const toggleOne = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        if (selected.size === items.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(items.map((i) => i.id)));
        }
    };

    const performAction = async (
        type: string,
        ids: string[],
        action: "approve" | "reject",
    ) => {
        const res = await fetch("/api/v1/admin/moderation", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ids, type, action }),
        });
        const failed = await writeError(res, commonT("somethingWentWrong"), t);
        if (failed) {
            toast.error(failed);
            return false;
        }
        return true;
    };

    const handleSingle = async (item: ModerationItem, action: "approve" | "reject") => {
        if (action === "reject") {
            const ok = await confirm({
                title: t("moderation_rejectSingleTitle"),
                message: t("moderation_rejectSingleMessage"),
                variant: "danger",
                confirmText: t("moderation_rejectSingle"),
            });
            if (!ok) return;
        }
        setWorking(true);
        try {
            const ok = await performAction(item.type, [item.id], action);
            if (ok) {
                toast.success(
                    action === "approve"
                        ? t("moderation_approvedSingle")
                        : t("moderation_rejectedSingle"),
                );
                await fetchCounts();
                await fetchItems();
            }
        } finally {
            setWorking(false);
        }
    };

    const handleBulk = async (action: "approve" | "reject") => {
        if (selected.size === 0) {
            toast.error(t("moderation_selectAtLeast"));
            return;
        }
        if (action === "reject") {
            const ok = await confirm({
                title: t("moderation_rejectTitle", { count: selected.size }),
                message: t("moderation_rejectMessage"),
                variant: "danger",
                confirmText: t("moderation_rejectAll"),
            });
            if (!ok) return;
        }
        setWorking(true);
        try {
            const byType = new Map<string, string[]>();
            for (const item of items) {
                if (!selected.has(item.id)) continue;
                const list = byType.get(item.type) ?? [];
                list.push(item.id);
                byType.set(item.type, list);
            }
            let totalAffected = 0;
            for (const [type, ids] of byType.entries()) {
                const ok = await performAction(type, ids, action);
                if (ok) totalAffected += ids.length;
            }
            toast.success(
                action === "approve"
                    ? t("moderation_approved", { count: totalAffected })
                    : t("moderation_rejected", { count: totalAffected }),
            );
            await fetchCounts();
            await fetchItems();
        } finally {
            setWorking(false);
        }
    };

    const totalAll = typeIds.reduce((sum, id) => sum + (counts[id] || 0), 0);

    return (
        <>
            <AdminPageHeader
                title={t("sidebar_moderationQueue")}
                description={t("moderation_description")}
            />

            <FilterChips
                className="mb-4"
                label={t("moderation_kind")}
                active={activeTab}
                onSelect={(id) => { setActiveTab(id); setPage(1); }}
                chips={[
                    { id: "all", label: t("moderation_all"), count: totalAll },
                    ...typeIds.map((id) => ({ id, label: typeLabel(id), count: counts[id] || 0 })),
                ]}
            />

            <Card>
                <CardContent className="p-0">
                    {items.length > 0 && (
                        <BulkBar
                            state={headerState(selected, items.map((i) => i.id))}
                            count={selected.size}
                            onToggleAll={toggleAll}
                            idle={t("moderation_itemsCount", { count: items.length })}
                            actions={
                                <>
                                    <Button size="sm" disabled={working} onClick={() => handleBulk("approve")}>
                                        <Check className="w-4 h-4" /> {t("moderation_approve")}
                                    </Button>
                                    <Button size="sm" variant="destructive" disabled={working} onClick={() => handleBulk("reject")}>
                                        <X className="w-4 h-4" /> {t("moderation_reject")}
                                    </Button>
                                </>
                            }
                        />
                    )}
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : items.length === 0 ? (
                        <p className="text-muted-foreground text-center py-12">
                            {t("moderation_nothingToReview")}
                        </p>
                    ) : (
                        <div className="divide-y">
                            {items.map((item) => (
                                <div key={`${item.type}:${item.id}`} className="p-4 flex items-start gap-3">
                                    <Checkbox
                                        checked={selected.has(item.id)}
                                        onChange={() => toggleOne(item.id)}
                                        aria-label={t("common_selectRow")}
                                        className="mt-0.5"
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            {/* A name, set as a name. It was
                                                uppercased and in a monospace
                                                face, which is how this site
                                                draws a machine's word. */}
                                            <Badge tone="neutral">{typeLabel(item.type)}</Badge>
                                            <span className="font-medium text-sm">
                                                {item.author?.username ?? t("moderation_anonymous")}
                                            </span>
                                            {item.title && (
                                                <span className="text-xs text-muted-foreground truncate">
                                                    {t("moderation_onTitle", { title: item.title })}
                                                </span>
                                            )}
                                            {item.href && (
                                                <Link
                                                    href={item.href}
                                                    target="_blank"
                                                    className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                                                >
                                                    <ExternalLink className="w-3 h-3" /> {t("moderation_view")}
                                                </Link>
                                            )}
                                        </div>
                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-3">
                                            {item.preview}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground mt-1">
                                            {formatDateTime(item.createdAt)}
                                        </p>
                                    </div>
                                    {/*
                                      * The two answers a row is waiting for,
                                      * and they are the point of the screen.
                                      * They were an outline button holding a
                                      * grey tick and a ghost button holding a
                                      * red cross - so the one thing an
                                      * operator came here to do was the
                                      * faintest thing on the row, and the two
                                      * halves of one decision did not look
                                      * like a pair. They say what they do now,
                                      * and the same two words appear on the
                                      * bar above when several rows are ticked.
                                      */}
                                    <div className="flex shrink-0 gap-2">
                                        <Button
                                            size="sm"
                                            disabled={working}
                                            onClick={() => handleSingle(item, "approve")}
                                        >
                                            <Check className="w-4 h-4" /> {t("moderation_approve")}
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="destructive"
                                            disabled={working}
                                            onClick={() => handleSingle(item, "reject")}
                                        >
                                            <X className="w-4 h-4" /> {t("moderation_reject")}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {activeTab !== "all" && (
                        <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />
                    )}
                </CardContent>
            </Card>
        </>
    );
}
