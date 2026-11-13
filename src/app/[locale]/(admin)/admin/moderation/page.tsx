"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Pagination } from "@/core/components/ui/pagination";
import { SegmentedTabs } from "@/core/components/ui/segmented-tabs";
import { Check, X, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { writeError } from "@/core/lib/write-result";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { FilterChips } from "@/core/components/admin/FilterChips";
import { BulkBar } from "@/core/components/admin/BulkBar";
import { headerState } from "@/core/lib/bulk-selection";
import { ModerationRow, type ModerationRowItem } from "./ModerationRow";
import { RejectDialog } from "./RejectDialog";

interface KindMeta {
    label: string;
    labelKey?: string;
    canListRejected?: boolean;
}

interface CountsPayload {
    counts: Record<string, number>;
    types: Record<string, KindMeta>;
}

interface ListPayload {
    items: ModerationRowItem[];
    total: number;
    page: number;
    pages: number;
}

type View = "pending" | "rejected";
type Action = "approve" | "reject" | "requeue";

/**
 * The moderation queue, and what it rejected.
 *
 * Rejecting used to be final and silent: the item left this screen and no
 * screen showed it again. The Rejected view lists it now beside the reason
 * and who gave it, for every kind whose module can list what it rejected,
 * and either view can send an item the other way.
 */
export default function ModerationPage() {
    const t = useTranslations("admin");
    const commonT = useTranslations("common");
    const [types, setTypes] = useState<Record<string, KindMeta>>({});
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [view, setView] = useState<View>("pending");
    const [activeTab, setActiveTab] = useState<string>("all");
    const [items, setItems] = useState<ModerationRowItem[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    /** The rows a rejection is being asked about; null while the dialog is closed. */
    const [rejecting, setRejecting] = useState<ModerationRowItem[] | null>(null);

    const typeIds = useMemo(
        () => Object.keys(types).filter((id) => view === "pending" || types[id].canListRejected),
        [types, view],
    );

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
        const state = view === "rejected" ? "&state=rejected" : "";
        try {
            if (activeTab === "all") {
                const results = await Promise.all(
                    typeIds.map((id) =>
                        fetch(`/api/v1/admin/moderation?type=${encodeURIComponent(id)}&page=1${state}`).then(
                            (r) => (r.ok ? (r.json() as Promise<ListPayload>) : null),
                        ),
                    ),
                );
                const combined: ModerationRowItem[] = [];
                let sum = 0;
                for (const r of results) {
                    if (r) {
                        combined.push(...r.items);
                        sum += r.total;
                    }
                }
                // Newest first: the queue by when an item was written, the
                // Rejected view by when it was decided.
                const when = (i: ModerationRowItem) => new Date(i.decision?.decidedAt ?? i.createdAt).getTime();
                combined.sort((a, b) => when(b) - when(a));
                setItems(combined);
                setTotal(sum);
                setPages(1);
                setPage(1);
            } else {
                const res = await fetch(
                    `/api/v1/admin/moderation?type=${encodeURIComponent(activeTab)}&page=${page}${state}`,
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
    }, [activeTab, page, typeIds, view]);

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

    /** One request per kind, since a decision is made by that kind's module. */
    const perform = async (rows: ModerationRowItem[], action: Action, extra: { reasonId?: string; note?: string } = {}) => {
        const byType = new Map<string, string[]>();
        for (const row of rows) byType.set(row.type, [...(byType.get(row.type) ?? []), row.id]);
        let done = 0;
        for (const [type, ids] of byType.entries()) {
            const res = await fetch("/api/v1/admin/moderation", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ ids, type, action, ...extra }),
            });
            const failed = await writeError(res, commonT("somethingWentWrong"), t);
            if (failed) toast.error(failed);
            else done += ids.length;
        }
        return done;
    };

    const finish = async (action: Action, done: number, single: boolean) => {
        if (done > 0) {
            const key = {
                approve: single ? "moderation_approvedSingle" : "moderation_approved",
                reject: single ? "moderation_rejectedSingle" : "moderation_rejected",
                requeue: single ? "moderation_requeuedSingle" : "moderation_requeued",
            }[action];
            toast.success(t(key, { count: done }));
        }
        await fetchCounts();
        await fetchItems();
    };

    const act = async (rows: ModerationRowItem[], action: Exclude<Action, "reject">) => {
        if (rows.length === 0) {
            toast.error(t("moderation_selectAtLeast"));
            return;
        }
        setWorking(true);
        try {
            await finish(action, await perform(rows, action), rows.length === 1);
        } finally {
            setWorking(false);
        }
    };

    const askReject = (rows: ModerationRowItem[]) => {
        if (rows.length === 0) {
            toast.error(t("moderation_selectAtLeast"));
            return;
        }
        setRejecting(rows);
    };

    const confirmReject = async (reasonId: string, note: string) => {
        if (!rejecting) return;
        const rows = rejecting;
        setWorking(true);
        try {
            const done = await perform(rows, "reject", { reasonId, ...(note ? { note } : {}) });
            setRejecting(null);
            await finish("reject", done, rows.length === 1);
        } finally {
            setWorking(false);
        }
    };

    const chosenRows = items.filter((i) => selected.has(i.id));
    const totalAll = typeIds.reduce((sum, id) => sum + (counts[id] || 0), 0);
    const anyRejectedView = Object.values(types).some((meta) => meta.canListRejected);

    const rowActions = (item: ModerationRowItem) =>
        view === "pending" ? (
            <>
                <Button size="sm" disabled={working} onClick={() => act([item], "approve")}>
                    <Check className="w-4 h-4" aria-hidden="true" /> {t("moderation_approve")}
                </Button>
                <Button size="sm" variant="destructive" disabled={working} onClick={() => askReject([item])}>
                    <X className="w-4 h-4" aria-hidden="true" /> {t("moderation_reject")}
                </Button>
            </>
        ) : (
            <>
                <Button size="sm" disabled={working} onClick={() => act([item], "approve")}>
                    <Check className="w-4 h-4" aria-hidden="true" /> {t("moderation_approve")}
                </Button>
                <Button size="sm" variant="outline" disabled={working} onClick={() => act([item], "requeue")}>
                    <Undo2 className="w-4 h-4" aria-hidden="true" /> {t("moderation_requeue")}
                </Button>
            </>
        );

    return (
        <>
            <AdminPageHeader
                title={t("sidebar_moderationQueue")}
                description={t("moderation_description")}
            />

            {anyRejectedView && (
                <SegmentedTabs
                    className="mb-4"
                    label={t("moderation_viewLabel")}
                    activeId={view}
                    onChange={(id) => { setView(id as View); setActiveTab("all"); setPage(1); }}
                    tabs={[
                        { id: "pending", label: t("moderation_viewPending") },
                        { id: "rejected", label: t("moderation_viewRejected") },
                    ]}
                />
            )}

            <FilterChips
                className="mb-4"
                label={t("moderation_kind")}
                active={activeTab}
                onSelect={(id) => { setActiveTab(id); setPage(1); }}
                chips={[
                    // The queue counts what waits; nothing counts the Rejected
                    // view, so its chips carry no number rather than a wrong one.
                    { id: "all", label: t("moderation_all"), count: view === "pending" ? totalAll : undefined },
                    ...typeIds.map((id) => ({ id, label: typeLabel(id), count: view === "pending" ? counts[id] || 0 : undefined })),
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
                                view === "pending" ? (
                                    <>
                                        <Button size="sm" disabled={working} onClick={() => act(chosenRows, "approve")}>
                                            <Check className="w-4 h-4" aria-hidden="true" /> {t("moderation_approve")}
                                        </Button>
                                        <Button size="sm" variant="destructive" disabled={working} onClick={() => askReject(chosenRows)}>
                                            <X className="w-4 h-4" aria-hidden="true" /> {t("moderation_reject")}
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <Button size="sm" disabled={working} onClick={() => act(chosenRows, "approve")}>
                                            <Check className="w-4 h-4" aria-hidden="true" /> {t("moderation_approve")}
                                        </Button>
                                        <Button size="sm" variant="outline" disabled={working} onClick={() => act(chosenRows, "requeue")}>
                                            <Undo2 className="w-4 h-4" aria-hidden="true" /> {t("moderation_requeue")}
                                        </Button>
                                    </>
                                )
                            }
                        />
                    )}
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
                        </div>
                    ) : items.length === 0 ? (
                        <p className="text-muted-foreground text-center py-12">
                            {view === "pending" ? t("moderation_nothingToReview") : t("moderation_nothingRejected")}
                        </p>
                    ) : (
                        <div className="divide-y">
                            {items.map((item) => (
                                <ModerationRow
                                    key={`${item.type}:${item.id}`}
                                    item={item}
                                    kindLabel={typeLabel(item.type)}
                                    selected={selected.has(item.id)}
                                    onToggle={() => toggleOne(item.id)}
                                    actions={rowActions(item)}
                                />
                            ))}
                        </div>
                    )}
                    {activeTab !== "all" && (
                        <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />
                    )}
                </CardContent>
            </Card>

            <RejectDialog
                count={rejecting ? rejecting.length : null}
                working={working}
                onCancel={() => setRejecting(null)}
                onConfirm={confirmReject}
            />
        </>
    );
}
