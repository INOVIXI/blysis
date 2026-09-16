"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Button, Card, CardContent, Input, LoadFailed, Pagination } from "@/core/sdk/ui";
import { PageFrame } from "@/core/sdk/layout";
import { Loader2, Search, Ban, VolumeX, LogOut, AlertTriangle } from "lucide-react";
import { dateLocaleTag } from "@/core/sdk";
import { punishmentStatus, type PunishmentStatus } from "../lib/status";
import { PUNISHMENT_TYPES, canonicalType, type PunishmentType } from "../lib/punishment-types";

interface PunishmentItem {
    id: string;
    playerName: string;
    type: string;
    reason: string | null;
    duration: string | null;
    active: boolean;
    punishedBy: string | null;
    createdAt: string;
    expiresAt: string | null;
}

const typeIcons: Record<PunishmentType, typeof Ban> = {
    ban: Ban,
    tempBan: Ban,
    mute: VolumeX,
    tempMute: VolumeX,
    kick: LogOut,
    warning: AlertTriangle,
};
const typeColors: Record<PunishmentType, string> = {
    ban: "bg-destructive/10 text-destructive",
    tempBan: "bg-destructive/10 text-destructive",
    mute: "bg-warning/10 text-warning",
    tempMute: "bg-warning/10 text-warning",
    kick: "bg-warning/10 text-warning",
    warning: "bg-primary/10 text-primary",
};

/**
 * A punishment's status was the one thing this table never said. It printed
 * the duration an admin had typed ("7d") next to a date months old and left
 * the reader to work out whether the ban was still running.
 */
const statusClass: Record<PunishmentStatus, string> = {
    active: "bg-destructive/10 text-destructive",
    expired: "bg-warning/10 text-warning",
    revoked: "bg-muted text-muted-foreground",
};

/** The label for one type, falling back to the value when it is unmapped. */
function typeLabel(t: { (key: string): string; has: (key: string) => boolean }, type: string): string {
    const key = canonicalType(type);
    return key && t.has(key) ? t(key) : type;
}

/**
 * The record, drawn from what the server already read.
 *
 * It used to fetch the first page on mount, so the HTML the server sent
 * carried no entry at all. The server reads the first page now and hands it
 * over; searching, filtering and paging still ask the endpoint.
 */
export function PunishmentList({ initial, initialPages }: { initial: PunishmentItem[]; initialPages: number }) {
    const __locale = useLocale();
    const __dateTag = dateLocaleTag(__locale);
    const t = useTranslations("punishments");
    const [punishments, setPunishments] = useState<PunishmentItem[]>(initial);
    const [failed, setFailed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState("");
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(initialPages);

    const fetchData = () => {
        setLoading(true);
        const params = new URLSearchParams({ page: String(page), limit: "20" });
        if (search) params.set("search", search);
        if (typeFilter) params.set("type", typeFilter);

        fetch(`/api/v1/punishments?${params}`)
            .then((r) => { if (!r.ok) throw new Error("load failed"); return r.json(); })
            .then((d) => { setPunishments(d.punishments || []); setTotalPages(d.pages || 1); setFailed(false); setLoading(false); })
            .catch(() => { setFailed(true); setLoading(false); });
    };

    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    /*
     * The first page is the one the server rendered, so asking for it again
     * would be a second read of the same rows. A ref rather than state: it
     * decides what the effect does and must not be why it runs.
     */
    const serverDrewThisPage = useRef(true);

    useEffect(() => {
        if (serverDrewThisPage.current) serverDrewThisPage.current = false;
        else fetchData();
    }, [page, typeFilter]);

    const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setPage(1); fetchData(); };

    return (
        <PageFrame
            title={t("title")}
            description={t("description")}
        >
            {/* The search box and the type filters read as one row, so they
                are one height: the box was h-11 beside h-8 buttons. */}
            <div className="flex flex-wrap items-center gap-3 mb-6">
                <form onSubmit={handleSearch} className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} className="pl-10" />
                </form>
                <div className="flex flex-wrap gap-2">
                    {["", ...PUNISHMENT_TYPES].map((tf) => (
                        <Button key={tf} variant={typeFilter === tf ? "default" : "outline"}
                            onClick={() => { setTypeFilter(tf); setPage(1); }}>
                            {tf === "" ? t("type") : typeLabel(t, tf)}
                        </Button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : failed ? (
                <LoadFailed onRetry={fetchData} />
            ) : punishments.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">{t("noPunishments")}</CardContent></Card>
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <table className="w-full bg-card rounded-xl border border-border">
                            <thead>
                                <tr className="border-b">
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("player")}</th>
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("type")}</th>
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("reason")}</th>
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("punishedBy")}</th>
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("duration")}</th>
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("date")}</th>
                                    <th className="text-left py-3 px-4 font-medium text-muted-foreground text-sm">{t("status")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {punishments.map((p) => {
                                    const known = canonicalType(p.type);
                                    const Icon = known ? typeIcons[known] : Ban;
                                    const status = punishmentStatus(p);
                                    return (
                                        <tr key={p.id} className="border-b last:border-0 hover:bg-muted">
                                            <td className="py-3 px-4 font-medium">{p.playerName}</td>
                                            <td className="py-3 px-4">
                                                <span className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${known ? typeColors[known] : ""}`}>
                                                    <Icon className="w-3 h-3" /> {typeLabel(t, p.type)}
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-sm text-muted-foreground max-w-[200px] truncate">{p.reason || "-"}</td>
                                            <td className="py-3 px-4 text-sm text-muted-foreground">{p.punishedBy || t("console")}</td>
                                            <td className="py-3 px-4 text-sm">{p.duration || t("permanent")}</td>
                                            <td className="py-3 px-4 text-sm text-muted-foreground">{new Date(p.createdAt).toLocaleDateString(__dateTag)}</td>
                                            <td className="py-3 px-4">
                                                <span className={`text-xs px-2 py-1 rounded ${statusClass[status]}`}>{t(status)}</span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <Pagination page={page} pages={totalPages} onPageChange={setPage} />
                </>
            )}
        </PageFrame>
    );
}
