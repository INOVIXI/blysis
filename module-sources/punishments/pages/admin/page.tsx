"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, CardContent, Input, Label, ListControls, Pagination, useConfirm, useFormRoute, NativeSelect, buttonClassName, useLocalDateTime, type BadgeTone } from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import { ArrowLeft, Loader2, Plus, Trash2, RotateCcw, Ban } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/core/sdk/admin";
import { punishmentStatus, type PunishmentStatus } from "../../lib/status";
import { PUNISHMENT_TYPES, canonicalType } from "../../lib/punishment-types";
import { ScopeManager } from "./ScopeManager";

interface Punishment {
    id: string;
    playerName: string;
    /** The module that reported it, or "site" for one issued here. */
    source: string;
    playerUuid: string | null;
    type: string;
    reason: string | null;
    duration: string | null;
    active: boolean;
    punishedBy: string | null;
    createdAt: string;
    expiresAt: string | null;
}

const STATUS_FILTERS = ["all", "active", "expired", "revoked"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/** The filter button's label, and the badge's, come from the same three keys. */
const FILTER_LABEL: Record<StatusFilter, string> = {
    all: "adm_filterAll",
    active: "adm_filterActive",
    expired: "adm_filterExpired",
    revoked: "adm_filterRevoked",
};

const STATUS_TONES: Record<PunishmentStatus, BadgeTone> = {
    active: "danger",
    expired: "warning",
    revoked: "neutral",
};

const PAGE_SIZE = 20;

export default function AdminPunishmentsPage() {
    const t = useTranslations("punishments");
    const commonT = useTranslations("common");
    // The site's zone, not the machine's: without it the server and the
    // browser disagree about what day a timestamp near midnight is.
    const formatDateTime = useLocalDateTime();
    const { confirm, ask } = useConfirm();
    const [items, setItems] = useState<Punishment[]>([]);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<StatusFilter>("all");
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [saving, setSaving] = useState(false);
    // The punishment form is a screen at `?form=new`, not a card wedged
    // between the filters and the table.
    const { showForm, formHref, closeForm } = useFormRoute();
    const [form, setForm] = useState({
        playerName: "",
        type: "ban",
        reason: "",
        duration: "",
        expiresAt: "",
    });

    // The filter and the paging both belong to the query. Filtering a fetched
    // page in the browser hid every match that fell outside it and still
    // printed the unfiltered total underneath.
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
            if (filter !== "all") params.set("status", filter);
            // The endpoint narrows by name, and the list a moderator reads is
            // the one screen where a name is the only thing they have.
            if (search.trim()) params.set("search", search.trim());
            const res = await fetch(`/api/v1/punishments?${params}`);
            const data = await res.json();
            setItems(data.punishments || []);
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

    const selectFilter = (next: StatusFilter) => { setFilter(next); setPage(1); };

    // A plugin may post a type this module has no word for; that value is
    // printed as it stands rather than as a missing message key.
    const typeLabel = (type: string) => {
        const key = canonicalType(type);
        return key && t.has(key) ? t(key) : type;
    };

    const create = async () => {
        if (!form.playerName.trim()) return;
        setSaving(true);
        try {
            const res = await fetch("/api/v1/punishments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    playerName: form.playerName.trim(),
                    type: form.type,
                    reason: form.reason || null,
                    duration: form.duration || null,
                    expiresAt: form.expiresAt || null,
                }),
            });
            if (!res.ok) throw new Error("create failed");
            toast.success(t("adm_createdToast"));
            setForm({ playerName: "", type: "ban", reason: "", duration: "", expiresAt: "" });
            await load();
            closeForm();
        } catch {
            toast.error(t("adm_error"));
        } finally {
            setSaving(false);
        }
    };

    const revoke = async (id: string, restore = false) => {
        /*
         * Asked rather than confirmed, because the answer is the record. A
         * punishment that stops with nothing said reads to the member it was
         * against exactly like one that ran out, and the reason an appeal was
         * upheld is the part worth keeping. Optional: `ask` returns "" for a
         * confirmed empty box and null when the admin backed out, so an
         * unanswered prompt still revokes and a cancelled one does nothing.
         */
        let liftReason: string | null = null;
        if (!restore) {
            liftReason = await ask({
                title: t("adm_revoke"),
                message: t("adm_revokeConfirm"),
                placeholder: t("adm_revokeReason"),
                confirmText: t("adm_revoke"),
            });
            if (liftReason === null) return;
        }
        try {
            const res = await fetch(`/api/v1/punishments/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ active: restore, liftReason: liftReason || null }),
            });
            if (!res.ok) throw new Error("revoke failed");
            toast.success(restore ? t("adm_restoredToast") : t("adm_revokedToast"));
            await load();
        } catch {
            toast.error(t("adm_error"));
        }
    };

    const remove = async (id: string) => {
        if (!(await confirm({ title: t("adm_delete"), message: t("adm_deleteConfirm"), confirmText: t("adm_delete"), variant: "danger" }))) return;
        try {
            const res = await fetch(`/api/v1/punishments/${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("delete failed");
            toast.success(t("adm_deletedToast"));
            await load();
        } catch {
            toast.error(t("adm_error"));
        }
    };

    if (showForm) {
        return (
            <div className="space-y-6">
                <AdminPageHeader
                    title={t("adm_newPunishment")}
                    description={t("adm_subtitle")}
                    onBack={closeForm}
                    backLabel={commonT("back")}
                />

                <ScopeManager />

                <Card>
                    <CardContent className="p-6 space-y-3">
                        <div className="grid md:grid-cols-2 gap-3">
                            <div>
                                <Label>{t("adm_playerName")}</Label>
                                <Input aria-label={t("adm_playerName")} value={form.playerName} onChange={e => setForm(f => ({ ...f, playerName: e.target.value }))} />
                                {/* A member's username links the punishment
                                    to their account; anything else is
                                    recorded as the name it was reported
                                    under. The field takes both because both
                                    happen. */}
                                <p className="mt-1 text-xs text-muted-foreground">{t("adm_playerNameHelp")}</p>
                            </div>
                            <div>
                                <Label>{t("adm_type")}</Label>
                                <NativeSelect
                                    aria-label={t("adm_type")} className="w-full" inputSize="sm"
                                    value={form.type}
                                    onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                                >
                                    {PUNISHMENT_TYPES.map(o => (
                                        <option key={o} value={o}>{t(o)}</option>
                                    ))}
                                </NativeSelect>
                            </div>
                            <div>
                                <Label>{t("adm_reason")}</Label>
                                <Input aria-label={t("adm_reason")} value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
                            </div>
                            <div>
                                <Label>{t("adm_duration")}</Label>
                                <Input aria-label={t("adm_duration")} value={form.duration} onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} placeholder="7d" />
                            </div>
                            <div className="md:col-span-2">
                                <Label>{t("adm_expiresAt")}</Label>
                                <Input aria-label={t("adm_expiresAt")} type="datetime-local" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={closeForm}>{commonT("cancel")}</Button>
                            <Button onClick={create} disabled={saving || !form.playerName.trim()}>
                                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("adm_creating")}</> : t("adm_create")}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <AdminPageHeader
                title={t("adm_title")}
                description={t("adm_subtitle")}
                actions={
                    <Link href={formHref()} className={buttonClassName("default", "default")}>
                            <Plus className="w-4 h-4" /> {t("adm_newPunishment")}
                        </Link>
                }
            />

            <ListControls
                search={{
                    value: search,
                    onChange: (term) => { setSearch(term); setPage(1); },
                    placeholder: t("adm_searchPlayer"),
                }}
            />

            {/* Filters only. The screen's primary action is the header's, at
                the size every other admin screen gives it; sitting it here in
                `sm` next to the filters made the same control look like a
                different, lesser one from one screen to the next. */}
            <div className="flex flex-wrap items-center gap-2">
                {STATUS_FILTERS.map(f => (
                    <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => selectFilter(f)}>
                        {t(FILTER_LABEL[f])}
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
                <div className="bg-card rounded-lg overflow-x-auto border border-border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className="px-4 py-2 text-left">{t("player")}</th>
                                <th className="px-4 py-2 text-left">{t("adm_source")}</th>
                                <th className="px-4 py-2 text-left">{t("type")}</th>
                                <th className="px-4 py-2 text-left">{t("reason")}</th>
                                <th className="px-4 py-2 text-left">{t("date")}</th>
                                <th className="px-4 py-2 text-left">{t("status")}</th>
                                <th className="px-4 py-2 text-right" />
                            </tr>
                        </thead>
                        <tbody>
                            {items.map(p => {
                                const status = punishmentStatus(p);
                                return (
                                <tr key={p.id} className="border-t">
                                    <td className="px-4 py-2 font-medium">{p.playerName}</td>
                                    {/* Where it came from, because a row an
                                        administrator wrote here and one a
                                        game server reported are answerable to
                                        different people. */}
                                    <td className="px-4 py-2 text-muted-foreground">
                                        {p.source === "site" ? t("adm_sourceSite") : p.source}
                                    </td>
                                    <td className="px-4 py-2">{typeLabel(p.type)}</td>
                                    <td className="px-4 py-2 text-muted-foreground">{p.reason || "-"}</td>
                                    <td className="px-4 py-2 text-muted-foreground">{formatDateTime(p.createdAt)}</td>
                                    <td className="px-4 py-2">
                                        <Badge tone={STATUS_TONES[status]}>{t(status)}</Badge>
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                        <div className="inline-flex gap-1">
                                            {p.active ? (
                                                <Button variant="ghost" size="sm" onClick={() => revoke(p.id, false)} title={t("adm_revoke")}>
                                                    <Ban className="w-4 h-4" />
                                                </Button>
                                            ) : (
                                                <Button variant="ghost" size="sm" onClick={() => revoke(p.id, true)} title={t("adm_unrevoke")}>
                                                    <RotateCcw className="w-4 h-4" />
                                                </Button>
                                            )}
                                            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(p.id)} title={t("adm_delete")}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />
                </div>
            )}
        </div>
    );
}
