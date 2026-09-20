"use client";

import { useCallback, useEffect, useState } from "react";
import { activityKinds, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, IconPicker, Input, Label, ListControls, Pagination, useRowList, Textarea, useConfirm, useFormRoute, NativeSelect, CheckboxField, buttonClassName } from "@/core/sdk/ui";
import { Link } from "@/core/sdk/navigation";
import {
    ArrowLeft,
    Plus,
    X,
    Loader2,
    Trash2,
    Pencil,
    Power,
    Users,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { AdminPageHeader, BulkBar, RowActions } from "@/core/sdk/admin";
import { deleteEach, errorMessage } from "@/core/sdk";
import { trophyConditions } from "../../lib/validations";

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
    /** The list, where a trophy has been written since it existed. */
    rules?: { event: string; threshold: number }[] | null;
    rulesMode?: string | null;
    isActive: boolean;
    createdAt: string;
    _count?: { users: number };
}


type FormState = {
    name: string;
    description: string;
    icon: string;
    color: string;
    points: string;
    ruleType: string;
    /** One row each: what they did, and how many times. */
    conditions: { event: string; threshold: string }[];
    rulesMode: string;
    isActive: boolean;
};

const BLANK_FORM: FormState = {
    name: "",
    description: "",
    icon: "Award",
    color: "#f59e0b",
    points: "10",
    ruleType: "event-count",
    conditions: [],
    rulesMode: "all",
    isActive: true,
};

/**
 * Every kind of activity anything on this site writes, which is what a trophy
 * can wait for.
 *
 * This screen used to keep its own list of fourteen suggested strings beside
 * a free text box. Three of them named nothing that is ever written -
 * `user.login`, `forum.topic.updated`, and `custom-forms.submission.created`,
 * which is a misspelling of a real one - so the suggestions themselves led an
 * operator to a trophy that could never be awarded. Core declares these and
 * names each in both languages; there is nothing here to keep in step.
 */
const KINDS = activityKinds();

/** The form holds strings because its boxes do; the API takes numbers. */
function conditionsPayload(rows: { event: string; threshold: string }[]) {
    return rows
        .filter((row) => row.event.trim() !== "")
        .map((row) => ({ event: row.event, threshold: Math.max(1, parseInt(row.threshold) || 1) }));
}

export default function AdminTrophiesPage() {
    const t = useTranslations("trophies");
    const commonT = useTranslations("common");
    const tc = useTranslations("admin");
    const { confirm } = useConfirm();
    // The kinds are named in the activity namespace, where the feed reads them.
    const activityT = useTranslations("activity");
    /** What a kind of event is called. Falls back to its own word. */
    const kindName = (type: string) => {
        const nameKey = KINDS.find((kind) => kind.type === type)?.nameKey;
        return nameKey && activityT.has(nameKey) ? activityT(nameKey) : type;
    };
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
            // The old columns are read as the list of one they describe, so a
            // trophy written before this change opens with its condition in
            // the list rather than empty.
            conditions: trophyConditions(editing).map((c) => ({ event: c.event, threshold: String(c.threshold) })),
            rulesMode: editing.rulesMode === "any" ? "any" : "all",
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

    const addCondition = () => setForm((f) => ({
        ...f,
        conditions: [...f.conditions, { event: KINDS[0]?.type ?? "", threshold: "1" }],
    }));

    const setCondition = (i: number, patch: Partial<{ event: string; threshold: string }>) =>
        setForm((f) => ({
            ...f,
            conditions: f.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
        }));

    const removeCondition = (i: number) =>
        setForm((f) => ({ ...f, conditions: f.conditions.filter((_, idx) => idx !== i) }));

    const handleSave = async () => {
        if (!form.name.trim()) {
            toast.error(t("nameRequired"));
            return;
        }
        setSaving(true);
        const conditions = conditionsPayload(form.conditions);
        const payload = {
            name: form.name.trim(),
            description: form.description.trim() || null,
            icon: form.icon.trim() || null,
            color: form.color.trim() || null,
            points: parseInt(form.points) || 0,
            ruleType: form.ruleType.trim() || "event-count",
            rules: conditions,
            rulesMode: form.rulesMode,
            // Kept in step so anything still reading the old columns - an
            // export, another installation's engine before it is updated -
            // sees the first condition rather than nothing.
            ruleEvent: conditions[0]?.event ?? null,
            ruleThreshold: conditions[0]?.threshold ?? null,
            isActive: form.isActive,
        };
        try {
            // The engine installs one listener per event, so it has to be
            // told whenever the set of events a trophy waits for changes -
            // which is the whole list now, not one column.
            const wasListeningFor = JSON.stringify(trophyConditions(editing ?? {}).map((c) => c.event).sort());
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
            if (JSON.stringify(conditions.map((c) => c.event).sort()) !== wasListeningFor) {
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
                                    {/* Picked, not typed. A misspelled icon
                                        name drew nothing and said nothing. */}
                                    <IconPicker
                                        value={form.icon}
                                        onChange={(icon) => setForm({ ...form, icon })}
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
                            <div>
                                <Label>{t("points")}</Label>
                                <Input
                                    aria-label={t("points")}
                                    type="number"
                                    className="max-w-40"
                                    value={form.points}
                                    onChange={(e) => setForm({ ...form, points: e.target.value })}
                                />
                            </div>

                            {/*
                              * What earns it.
                              *
                              * This was one free text box holding a string
                              * like `forum.topic.created`: an operator had to
                              * know the string existed, spell it, and know it
                              * was the one the engine counts - and a
                              * misspelling made a trophy nobody could ever be
                              * given, with nothing on the screen to say so.
                              * The site declares every kind of activity
                              * anything writes and names each one in both
                              * languages, so those are what is offered.
                              *
                              * And there is more than one of them now. A
                              * trophy for somebody who has written ten forum
                              * posts and bought something could not be
                              * described at all before.
                              */}
                            <div className="space-y-3 rounded-lg border border-border p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <Label>{t("adm_conditions")}</Label>
                                        <p className="text-xs text-muted-foreground">{t("adm_conditionsHint")}</p>
                                    </div>
                                    <Button type="button" variant="outline" size="sm" onClick={addCondition}>
                                        <Plus className="w-3 h-3" /> {t("adm_addCondition")}
                                    </Button>
                                </div>

                                {form.conditions.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">{t("adm_manualOnly")}</p>
                                ) : (
                                    <>
                                        {form.conditions.map((condition, i) => (
                                            <div key={i} className="grid gap-2 md:grid-cols-[1fr_8rem_auto] md:items-end">
                                                <div>
                                                    <Label>{t("adm_conditionEvent")}</Label>
                                                    <NativeSelect
                                                        aria-label={t("adm_conditionEvent")}
                                                        className="w-full"
                                                        value={condition.event}
                                                        onChange={(e) => setCondition(i, { event: e.target.value })}
                                                    >
                                                        {/* A kind whose module has since been
                                                            uninstalled is still what this trophy
                                                            waits for, so it stays in the list and
                                                            says what happened to it. */}
                                                        {!KINDS.some((k) => k.type === condition.event) && condition.event && (
                                                            <option value={condition.event}>
                                                                {t("adm_kindGone", { type: condition.event })}
                                                            </option>
                                                        )}
                                                        {KINDS.map((kind) => (
                                                            <option key={kind.type} value={kind.type}>
                                                                {activityT.has(kind.nameKey) ? activityT(kind.nameKey) : kind.type}
                                                            </option>
                                                        ))}
                                                    </NativeSelect>
                                                </div>
                                                <div>
                                                    <Label>{t("adm_conditionThreshold")}</Label>
                                                    <Input
                                                        aria-label={t("adm_conditionThreshold")}
                                                        type="number"
                                                        min="1"
                                                        value={condition.threshold}
                                                        onChange={(e) => setCondition(i, { threshold: e.target.value })}
                                                    />
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    aria-label={t("adm_removeCondition")}
                                                    onClick={() => removeCondition(i)}
                                                >
                                                    <X className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        ))}

                                        {/* Only worth asking once there are two. */}
                                        {form.conditions.length > 1 && (
                                            <div>
                                                <Label>{t("adm_mode")}</Label>
                                                {/* The measure is on the
                                                    control, not on the
                                                    screen. */}
                                                <NativeSelect
                                                    aria-label={t("adm_mode")}
                                                    className="w-full max-w-60"
                                                    value={form.rulesMode}
                                                    onChange={(e) => setForm({ ...form, rulesMode: e.target.value })}
                                                >
                                                    <option value="all">{t("adm_modeAll")}</option>
                                                    <option value="any">{t("adm_modeAny")}</option>
                                                </NativeSelect>
                                            </div>
                                        )}
                                    </>
                                )}
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
                                                        {/* The name, and nothing under it. A cuid said
                                                            nothing to anybody and took the line where
                                                            something might have. */}
                                                        <div className="font-medium">{row.name}</div>
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
                                                        {/* The name of the event, not the event. The
                                                            form above offers these by name already;
                                                            the list printed `forum.post.created` in
                                                            monospace beside it. */}
                                                        <span className="text-xs">{kindName(row.ruleEvent)}</span>
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
                                                <RowActions
                                                    actions={[
                                                        { icon: Pencil, label: tc("common_edit"), onClick: () => openForm(row.id) },
                                                        { icon: Trash2, label: tc("common_delete"), onClick: () => handleDelete(row), destructive: true },
                                                    ]}
                                                />
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
