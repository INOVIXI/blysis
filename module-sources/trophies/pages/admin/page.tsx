"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, ListControls, Pagination, useRowList, Textarea, useConfirm, useFormRoute, NativeSelect, CheckboxField, buttonClassName } from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import {
    ArrowLeft,
    Plus,
    Loader2,
    Trash2,
    Pencil,
    Power,
    Users,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { AdminPageHeader, BulkBar } from "@/core/sdk/admin";
import { deleteEach, errorMessage } from "@/core/sdk";

interface AdminTrophy {
    id: string;
    name: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    points: number;
    ruleType: string | null;
    ruleEvent: string | null;
    ruleThreshold: number | null;
    isActive: boolean;
    createdAt: string;
    _count?: { users: number };
}

const SUGGESTED_EVENTS = [
    "user.registered",
    "user.login",
    "forum.topic.created",
    "forum.post.created",
    "forum.topic.updated",
    "blog.article.created",
    "store.order.completed",
    "vote.vote.cast",
    "wheel.prize.won",
    "suggestions.suggestion.created",
    "tickets.ticket.opened",
    "custom-forms.submission.created",
    "downloads.file.downloaded",
    "credits.credit.added",
];

type FormState = {
    name: string;
    description: string;
    icon: string;
    color: string;
    points: string;
    ruleType: string;
    ruleEvent: string;
    ruleThreshold: string;
    isActive: boolean;
};

const BLANK_FORM: FormState = {
    name: "",
    description: "",
    icon: "Award",
    color: "#f59e0b",
    points: "10",
    ruleType: "event-count",
    ruleEvent: "",
    ruleThreshold: "1",
    isActive: true,
};

export default function AdminTrophiesPage() {
    const t = useTranslations("trophies");
    const commonT = useTranslations("common");
    const tc = useTranslations("admin");
    const { confirm } = useConfirm();
    const [trophies, setTrophies] = useState<AdminTrophy[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    // The editor used to be a modal over the table. A modal is the same
    // screen wearing one address: nothing about it is in the URL, so it cannot
    // be linked, reloaded or closed with the back button. It is now a screen
    // at `?form=new` or `?form=<id>`.
    const { showForm, editingId, formHref, openForm, closeForm } = useFormRoute();
    const [form, setForm] = useState<FormState>(BLANK_FORM);
    // The two lines the table draws. This list grows every time somebody
    // adds one, and paging to a row was the only way to reach it.
    const list = useRowList(trophies, { text: (row) => [row.name, row.description], pageSize: 10 });

    const fetchTrophies = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/v1/admin/trophies");
            if (res.ok) {
                const data = await res.json();
                setTrophies(data.trophies || []);
            } else {
                toast.error(t("loadFailed"));
            }
        } catch {
            toast.error(t("loadFailed"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        fetchTrophies();
    }, [fetchTrophies]);

    const editing = editingId ? trophies.find((row) => row.id === editingId) ?? null : null;

    // The trophy the URL names fills the form once the rows arrive, so
    // `?form=<id>` survives a reload rather than opening a blank editor.
    useEffect(() => {
        if (!editing) {
            setForm(BLANK_FORM);
            return;
        }
        setForm({
            name: editing.name,
            description: editing.description || "",
            icon: editing.icon || "Award",
            color: editing.color || "#f59e0b",
            points: String(editing.points),
            ruleType: editing.ruleType || "event-count",
            ruleEvent: editing.ruleEvent || "",
            ruleThreshold: String(editing.ruleThreshold ?? 1),
            isActive: editing.isActive,
        });
    }, [editing]);

    const reloadEngine = async () => {
        try {
            await fetch("/api/v1/admin/trophies/reload", { method: "POST" });
        } catch {
            /* non-fatal */
        }
    };

    const handleSave = async () => {
        if (!form.name.trim()) {
            toast.error(t("nameRequired"));
            return;
        }
        setSaving(true);
        const payload = {
            name: form.name.trim(),
            description: form.description.trim() || null,
            icon: form.icon.trim() || null,
            color: form.color.trim() || null,
            points: parseInt(form.points) || 0,
            ruleType: form.ruleType.trim() || "event-count",
            ruleEvent: form.ruleEvent.trim() || null,
            ruleThreshold: parseInt(form.ruleThreshold) || 1,
            isActive: form.isActive,
        };
        try {
            const originalEvent = editing?.ruleEvent || null;
            const res = await fetch(
                editing ? `/api/v1/admin/trophies/${editing.id}` : "/api/v1/admin/trophies",
                {
                    method: editing ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                }
            );
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(errorMessage(data, t("saveFailed"), t));
                return;
            }
            toast.success(editing ? t("updated") : t("created"));
            if (payload.ruleEvent !== originalEvent) {
                await reloadEngine();
            }
            closeForm();
            fetchTrophies();
        } catch {
            toast.error(t("saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (row: AdminTrophy) => {
        const ok = await confirm({
            title: t("deleteTitle"),
            message: t("deleteMessage", { name: row.name }),
            variant: "danger",
            confirmText: tc("common_delete"),
        });
        if (!ok) return;
        try {
            const res = await fetch(`/api/v1/admin/trophies/${row.id}`, { method: "DELETE" });
            if (res.ok) {
                toast.success(t("deleted"));
                fetchTrophies();
            } else {
                toast.error(t("deleteFailed"));
            }
        } catch {
            toast.error(t("deleteFailed"));
        }
    };

    const deleteMany = async () => {
        const ok = await confirm({
            title: t("deleteTitle"),
            message: t("deleteManyMessage", { count: list.picked.size }),
            variant: "danger",
            confirmText: tc("common_delete"),
        });
        if (!ok) return;
        const { deleted, total } = await deleteEach([...list.picked], async (id) => {
            const res = await fetch(`/api/v1/admin/trophies/${id}`, { method: "DELETE" });
            return res.ok;
        });
        list.clear();
        fetchTrophies();
        if (deleted === total) toast.success(t("deleted"));
        else if (deleted === 0) toast.error(t("deleteFailed"));
        else toast.error(t("deletedPartly", { deleted, total }));
    };

    const toggleActive = async (row: AdminTrophy) => {
        try {
            const res = await fetch(`/api/v1/admin/trophies/${row.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isActive: !row.isActive }),
            });
            if (res.ok) {
                setTrophies((prev) =>
                    prev.map((x) => (x.id === row.id ? { ...x, isActive: !row.isActive } : x))
                );
                toast.success(!row.isActive ? t("activated") : t("deactivated"));
                await reloadEngine();
            } else {
                toast.error(t("toggleFailed"));
            }
        } catch {
            toast.error(t("toggleFailed"));
        }
    };

    if (showForm) {
        return (
            <div>
                <AdminPageHeader
                    title={editing ? t("editTrophy") : t("newTrophy")}
                    description={t("adm_description")}
                    onBack={closeForm}
                    backLabel={commonT("back")}
                />

                <Card>
                    <CardContent className="p-6">
                        <div className="space-y-4">
                            <div>
                                <Label>{t("name")}</Label>
                                <Input
                                    aria-label={t("name")}
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    placeholder={t("adm_namePlaceholder")}
                                />
                            </div>
                            <div>
                                <Label>{t("descriptionLabel")}</Label>
                                <Textarea
                                    aria-label={t("descriptionLabel")}
                                    value={form.description}
                                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                                    placeholder={t("adm_descriptionPlaceholder")}
                                    rows={2}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label>{t("lucideIcon")}</Label>
                                    <Input
                                        aria-label={t("lucideIcon")}
                                        value={form.icon}
                                        onChange={(e) => setForm({ ...form, icon: e.target.value })}
                                        placeholder={t("adm_categoryPlaceholder")}
                                    />
                                </div>
                                <div>
                                    <Label>{t("color")}</Label>
                                    <div className="flex gap-2 items-center">
                                        <Input
                                            aria-label={t("color")}
                                            type="color"
                                            value={form.color}
                                            onChange={(e) => setForm({ ...form, color: e.target.value })}
                                            className="w-12 h-9 p-1"
                                        />
                                        <Input
                                            value={form.color}
                                            onChange={(e) => setForm({ ...form, color: e.target.value })}
                                            placeholder="#f59e0b" aria-label={t("color")}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label>{t("points")}</Label>
                                    <Input
                                        aria-label={t("points")}
                                        type="number"
                                        value={form.points}
                                        onChange={(e) => setForm({ ...form, points: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <Label>{t("ruleType")}</Label>
                                    <NativeSelect
                                        aria-label={t("ruleType")}
                                        value={form.ruleType}
                                        onChange={(e) => setForm({ ...form, ruleType: e.target.value })} className="w-full" inputSize="sm"
                                    >
                                        <option value="event-count">event-count</option>
                                    </NativeSelect>
                                </div>
                            </div>
                            <div>
                                <Label>{t("ruleEvent")}</Label>
                                <Input
                                    aria-label={t("ruleEvent")}
                                    list="trophy-event-suggestions"
                                    value={form.ruleEvent}
                                    onChange={(e) => setForm({ ...form, ruleEvent: e.target.value })}
                                    placeholder="forum.topic.created"
                                />
                                <datalist id="trophy-event-suggestions">
                                    {SUGGESTED_EVENTS.map((ev) => (
                                        <option key={ev} value={ev} />
                                    ))}
                                </datalist>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t("ruleEventHint")}
                                </p>
                            </div>
                            <div>
                                <Label>{t("ruleThreshold")}</Label>
                                <Input
                                    aria-label={t("ruleThreshold")}
                                    type="number"
                                    min="1"
                                    value={form.ruleThreshold}
                                    onChange={(e) => setForm({ ...form, ruleThreshold: e.target.value })}
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    {t("thresholdHint")}
                                </p>
                            </div>
                            <CheckboxField
                                id="trophy-active"
                                checked={form.isActive}
                                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                                label={t("activeLabel")}
                            />
                        </div>
                        <div className="flex justify-end gap-2 pt-4 border-t border-border mt-4">
                            <Button variant="outline" onClick={closeForm} disabled={saving}>
                                {tc("common_cancel")}
                            </Button>
                            <Button onClick={handleSave} disabled={saving}>
                                {saving ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" /> {t("saving")}
                                    </>
                                ) : editing ? (
                                    t("saveChanges")
                                ) : (
                                    tc("common_create")
                                )}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div>
            <AdminPageHeader
                title={t("title")}
                description={t("adm_description")}
                actions={<>
                    <Link href={formHref()} className={buttonClassName("default", "default")}><Plus className="w-4 h-4" /> {tc("common_add")}</Link>
                </>}
            />

            <ListControls className="mb-4" search={{ value: list.search, onChange: list.setSearch }} />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">
                        {trophies.length} {trophies.length === 1 ? t("trophy") : t("title")}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : trophies.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">
                            {t("noTrophies")}
                        </p>
                    ) : list.rows.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">{commonT("noResults")}</p>
                    ) : (
                        <>
                            {/* Outside the scrolling box, or the select-all
                                box scrolls off a narrow screen with the
                                table. */}
                            <BulkBar
                                state={list.headerState}
                                count={list.picked.size}
                                onToggleAll={list.toggleAll}
                                actions={
                                    <Button variant="destructive" size="sm" onClick={deleteMany}>
                                        <Trash2 className="w-4 h-4" /> {tc("common_delete")} {list.picked.size}
                                    </Button>
                                }
                            />
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border text-left text-muted-foreground">
                                        <th className="w-10 py-2 pr-3" />
                                        <th className="py-2 pr-3">{t("trophy")}</th>
                                        <th className="py-2 pr-3">{tc("common_description")}</th>
                                        <th className="py-2 pr-3">{t("points")}</th>
                                        <th className="py-2 pr-3">{t("rule")}</th>
                                        <th className="py-2 pr-3">{t("earned")}</th>
                                        <th className="py-2 pr-3">{t("active")}</th>
                                        <th className="py-2 pr-3 text-right">{t("actions")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {list.rows.map((row) => (
                                        <tr key={row.id} className="border-b border-border/50">
                                            <td className="py-2 pr-3">
                                                <Checkbox
                                                    checked={list.picked.has(row.id)}
                                                    onChange={() => list.toggle(row.id)}
                                                    aria-label={t("selectRow")}
                                                />
                                            </td>
                                            <td className="py-2 pr-3">
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                                                        style={{ backgroundColor: row.color || "#6366f1" }}
                                                    >
                                                        {(row.icon || row.name).slice(0, 2)}
                                                    </div>
                                                    <div>
                                                        <div className="font-medium">{row.name}</div>
                                                        <div className="text-xs text-muted-foreground">{row.id}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-2 pr-3 max-w-[240px] truncate text-muted-foreground">
                                                {row.description || "-"}
                                            </td>
                                            <td className="py-2 pr-3 font-medium">{row.points}</td>
                                            <td className="py-2 pr-3">
                                                {row.ruleEvent ? (
                                                    <div className="flex flex-col">
                                                        <code className="text-xs">{row.ruleEvent}</code>
                                                        <span className="text-xs text-muted-foreground">
                                                            x{row.ruleThreshold ?? 1}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <span className="text-muted-foreground text-xs">{t("manualOnly")}</span>
                                                )}
                                            </td>
                                            <td className="py-2 pr-3">
                                                <span className="inline-flex items-center gap-1 text-muted-foreground">
                                                    <Users className="w-3 h-3" />
                                                    {row._count?.users ?? 0}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-3">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleActive(row)}
                                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                                                        row.isActive
                                                            ? "bg-success/10 text-success"
                                                            : "bg-muted text-muted-foreground"
                                                    }`}
                                                >
                                                    <Power className="w-3 h-3" />
                                                    {row.isActive ? t("activeLabel") : t("inactiveLabel")}
                                                </button>
                                            </td>
                                            <td className="py-2 pr-3 text-right whitespace-nowrap">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openForm(row.id)}
                                                    title={tc("common_edit")}
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-destructive"
                                                    onClick={() => handleDelete(row)}
                                                    title={tc("common_delete")}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <Pagination page={list.page} pages={list.pages} total={list.total} onPageChange={list.setPage} />
                        </div>
                        </>
                    )}
                </CardContent>
            </Card>

        </div>
    );
}
