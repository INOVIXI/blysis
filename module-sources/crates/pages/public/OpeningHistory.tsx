"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, LoadFailed, Pagination, useLocalDate } from "@/core/sdk/ui";
import { rarityTone } from "../../lib/crates";

interface OpeningRow {
    id: string;
    crateName: string;
    rewardName: string;
    rarity: string;
    paidWith: string;
    cost: number;
    createdAt: string;
}

interface OpeningHistoryProps {
    /** Bumped by the page after an opening, so the newest one appears. */
    refreshKey: number;
}

/** What this member opened and what came out of it, newest first. */
export function OpeningHistory({ refreshKey }: OpeningHistoryProps) {
    const t = useTranslations("crates");
    const formatLocalDate = useLocalDate();
    const [rows, setRows] = useState<OpeningRow[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [failed, setFailed] = useState(false);
    const [retryKey, setRetryKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/v1/crates/history?page=${page}`)
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d) => {
                if (cancelled) return;
                setRows(d.openings ?? []);
                setPages(Number(d.pages ?? 1));
                setTotal(Number(d.total ?? 0));
                setFailed(false);
            })
            .catch(() => { if (!cancelled) setFailed(true); });
        return () => { cancelled = true; };
    }, [page, refreshKey, retryKey]);

    return (
        <div className="bg-card rounded-xl border border-border p-5">
            <h2 className="font-bold text-foreground mb-3">{t("historyTitle")}</h2>
            {failed ? (
                <LoadFailed onRetry={() => setRetryKey((k) => k + 1)} />
            ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("historyEmpty")}</p>
            ) : (
                <ul className="space-y-3 text-sm">
                    {rows.map((row) => (
                        <li key={row.id} className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-foreground">{row.crateName}</span>
                                <Badge tone={rarityTone(row.rarity)}>{row.rewardName}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {formatLocalDate(row.createdAt)} · {row.paidWith === "credits" ? t("paidCredits", { count: row.cost }) : t("paidKey")}
                            </p>
                        </li>
                    ))}
                </ul>
            )}
            {pages > 1 && <Pagination page={page} pages={pages} total={total} onPageChange={setPage} className="mt-4" />}
        </div>
    );
}
