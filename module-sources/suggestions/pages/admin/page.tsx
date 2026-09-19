"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, CardContent, ListControls, Pagination, useConfirm, NativeSelect, useLocalDate } from "@/core/sdk/ui";
import { Loader2, Trash2, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { SUGGESTION_STATUSES, STATUS_BADGE_CLASS, canonicalStatus } from "../../lib/statuses";
import { AdminPageHeader } from "@/core/sdk/admin";

interface Suggestion {
    id: string;
    title: string;
    content: string;
    status: string;
    upvotes: number;
    createdAt: string;
    author?: { username: string | null } | null;
}

// "All" and then one filter per status the board can actually be in. The
// list used to name four of the six, so two statuses an admin could set had
// no way to be filtered for afterwards.
const FILTERS = ["all", ...SUGGESTION_STATUSES] as const;

const PAGE_SIZE = 20;

export default function AdminSuggestionsPage() {
    const t = useTranslations("suggestions");
    const commonT = useTranslations("common");
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDate = useLocalDate();
    const { confirm } = useConfirm();
    const [items, setItems] = useState<Suggestion[]>([]);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);

    // The board is the one screen where an old suggestion has to stay
    // reachable. This asked for two hundred in one go, got the hundred the
    // endpoint caps at, rendered every one of them, and offered no way to the
    // ones behind: a board past its first hundred could not be moderated.
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
            if (filter !== "all") params.set("status", filter);
            if (search.trim()) params.set("search", search.trim());
            const res = await fetch(`/api/v1/suggestions?${params}`);
            const data = await res.json();
            setItems(data.suggestions || []);
            setPages(data.pages || 1);
            setTotal(data.total || 0);
        } catch {
            setItems([]);
            setPages(1);
            setTotal(0);
        } finally {
            setLoading(false);
        }
    }, [page, filter, search]);

    useEffect(() => { load(); }, [load]);

    const selectFilter = (next: (typeof FILTERS)[number]) => { setFilter(next); setPage(1); };

    const changeStatus = async (id: string, status: string) => {
        try {
            const res = await fetch(`/api/v1/suggestions/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status }),
            });
            if (!res.ok) throw new Error("failed");
            toast.success(t("adm_statusChangedToast"));
            await load();
        } catch {
            toast.error(t("adm_error"));
        }
    };

    const remove = async (id: string) => {
        if (!(await confirm({
            title: t("adm_delete"),
            message: t("adm_deleteConfirm"),
            confirmText: t("adm_delete"),
            variant: "danger",
        }))) return;
        try {
            const res = await fetch(`/api/v1/suggestions/${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("failed");
            toast.success(t("adm_deletedToast"));
            await load();
        } catch {
            toast.error(t("adm_error"));
        }
    };

    // Compared through the fold, so a row written under an older spelling of
    // the same status is not hidden by the filter for it.
    // A status this board has no word for is printed as it stands rather than
    // as a message key nothing declared.
    const statusLabel = (status: string) => {
        const known = canonicalStatus(status);
        return known ? t(known) : status;
    };
    const badgeClass = (status: string) => {
        const known = canonicalStatus(status);
        return known ? STATUS_BADGE_CLASS[known] : "bg-muted text-muted-foreground";
    };

    return (
        <div className="space-y-6">
            <AdminPageHeader
                title={t("adm_title")}
                description={t("adm_subtitle")}
            />

            <ListControls
                search={{ value: search, onChange: (term) => { setSearch(term); setPage(1); } }}
            />

            <div className="flex flex-wrap gap-2">
                {FILTERS.map(f => (
                    <Button
                        key={f}
                        variant={filter === f ? "default" : "outline"}
                        size="sm"
                        onClick={() => selectFilter(f)}
                    >
                        {f === "all" ? t("adm_filterAll") : t(f)}
                    </Button>
                ))}
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
            ) : items.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        {search.trim() === "" ? t("adm_empty") : commonT("noResults")}
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-3">
                    {items.map(s => (
                        <Card key={s.id}>
                            <CardContent className="p-4 flex flex-col md:flex-row gap-4">
                                <div className="flex flex-col items-center justify-center min-w-16 px-2 py-1 rounded bg-muted">
                                    <ThumbsUp className="w-4 h-4 text-muted-foreground mb-1" />
                                    <span className="text-lg font-bold">{s.upvotes}</span>
                                    <span className="text-[10px] text-muted-foreground">{t("votes")}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start gap-2 mb-1">
                                        <h2 className="font-semibold flex-1">{s.title}</h2>
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badgeClass(s.status)}`}>
                                            {statusLabel(s.status)}
                                        </span>
                                    </div>
                                    <p className="text-sm text-muted-foreground line-clamp-3 mb-2">{s.content}</p>
                                    <div className="text-xs text-muted-foreground">
                                        {t("submittedBy")} {s.author?.username || t("deletedUser")} · {formatDate(s.createdAt)}
                                    </div>
                                </div>
                                <div className="flex md:flex-col gap-2 items-end">
                                    <NativeSelect inputSize="sm"
                                        value={s.status}
                                        onChange={e => changeStatus(s.id, e.target.value)}
                                        aria-label={t("adm_setStatus")}
                                    >
                                        {SUGGESTION_STATUSES.map(o => (
                                            <option key={o} value={o}>{t(o)}</option>
                                        ))}
                                    </NativeSelect>
                                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(s.id)}>
                                        <Trash2 className="w-4 h-4" /> {t("adm_delete")}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                    <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />
                </div>
            )}
        </div>
    );
}
