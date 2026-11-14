"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AdminPageHeader } from "@/core/sdk/admin";
import { Badge, Card, CardContent, ListControls, LoadFailed, Pagination, Waiting, useLocalDate } from "@/core/sdk/ui";
import { rarityTone } from "../../../lib/crates";

interface OpeningRow {
    id: string;
    crateName: string;
    rewardName: string;
    rarity: string;
    paidWith: string;
    cost: number;
    createdAt: string;
    user: { id: string; username: string | null } | null;
}

/**
 * Every opening, newest first: who opened what, how they paid and what came
 * out. Read-only, because an opening is a record of something that happened,
 * and what it handed over already left for the member's chest or wallet.
 */
export default function Page() {
    const t = useTranslations("crates");
    const formatLocalDate = useLocalDate();
    const [rows, setRows] = useState<OpeningRow[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [query, setQuery] = useState("");

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/v1/crates/admin/openings?page=${page}&q=${encodeURIComponent(query)}`)
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d) => {
                if (cancelled) return;
                setRows(d.openings ?? []);
                setPages(Number(d.pages ?? 1));
                setTotal(Number(d.total ?? 0));
                setFailed(false);
                setLoading(false);
            })
            .catch(() => { if (!cancelled) { setFailed(true); setLoading(false); } });
        return () => { cancelled = true; };
    }, [page, query, reloadKey]);

    return (
        <div className="space-y-6">
            <AdminPageHeader title={t("adm_openings_title")} description={t("adm_openings_subtitle")} />
            <ListControls search={{ value: query, onChange: (term) => { setQuery(term); setPage(1); }, placeholder: t("adm_openings_search") }} />
            {loading ? (
                <Waiting label={t("loading")} />
            ) : failed ? (
                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
            ) : rows.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">{t("adm_openings_empty")}</CardContent></Card>
            ) : (
                <Card>
                    <CardContent className="p-0">
                        <ul className="divide-y divide-border">
                            {rows.map((row) => (
                                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                                    <div className="min-w-0">
                                        <p className="font-medium text-foreground">
                                            {t("adm_openings_row", { user: row.user?.username ?? t("adm_openings_gone"), crate: row.crateName })}
                                        </p>
                                        <p className="text-muted-foreground">
                                            {formatLocalDate(row.createdAt)} · {row.paidWith === "credits" ? t("paidCredits", { count: row.cost }) : t("paidKey")}
                                        </p>
                                    </div>
                                    <Badge tone={rarityTone(row.rarity)}>{row.rewardName}</Badge>
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            )}
            {pages > 1 && <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />}
        </div>
    );
}
