"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Minus, Plus, Trash2, Type, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Input,
    Label,
    ListControls,
    LoadFailed,
    NativeSelect,
    Pagination,
    Textarea,
    useConfirm,
    useRowList,
} from "@/core/sdk/ui";
import { AdminPageHeader } from "@/core/sdk/admin";
import { writeError } from "@/core/sdk";
import type { DraftCell } from "../../lib/table-payload";

/**
 * Building a table for choosing between things.
 *
 * The control that matters is the cell, and it has three states rather than
 * two: yes, no, and nobody said. A tick box would collapse the last two, and
 * the table would start telling somebody deciding what to pay for that a thing
 * lacks a feature nobody ever ruled on. So a cell cycles through four settings
 * and starts in the one that claims nothing.
 *
 * The whole table is saved at once, because columns, groups, rows and cells
 * only mean anything together and a reader arriving between two half-saves
 * would see a comparison stating things nobody wrote.
 */

type CellKind = "unstated" | "yes" | "no" | "value";

interface DraftColumn { key: string; label: string; subtitle: string; href: string; highlight: boolean }
interface DraftGroup { key: string; label: string }
interface DraftRow { key: string; groupKey: string; label: string }

interface Draft {
    id: string | null;
    slug: string;
    title: string;
    description: string;
    isActive: boolean;
    order: number;
    /** What the table is about. "" means the operator types the columns. */
    subjectRef: string;
    columns: DraftColumn[];
    groups: DraftGroup[];
    rows: DraftRow[];
    cells: Record<string, { kind: CellKind; value: string }>;
}

/** A key the server maps to a fresh id; it never leaves this screen. */
let counter = 0;
const newKey = (prefix: string) => `${prefix}${(counter += 1)}`;

const EMPTY: Draft = {
    id: null, slug: "", title: "", description: "", isActive: true, order: 0,
    subjectRef: "", columns: [], groups: [], rows: [], cells: {},
};

const at = (rowKey: string, columnKey: string) => `${rowKey}|${columnKey}`;

/** Round and round: nobody said, yes, no, a value of its own. */
const NEXT: Record<CellKind, CellKind> = { unstated: "yes", yes: "no", no: "value", value: "unstated" };

interface StoredTable {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    isActive: boolean;
    order: number;
    subjectRef: string | null;
    columns: { id: string; label: string; subtitle: string | null; href: string | null; highlight: boolean }[];
    groups: { id: string; label: string }[];
    rows: { id: string; groupId: string | null; label: string; cells: { columnId: string; kind: string; value: string | null }[] }[];
}

function toDraft(table: StoredTable): Draft {
    const cells: Draft["cells"] = {};
    for (const row of table.rows) {
        for (const cell of row.cells) {
            cells[at(row.id, cell.columnId)] = {
                kind: (cell.kind as CellKind) ?? "unstated",
                value: cell.value ?? "",
            };
        }
    }
    return {
        id: table.id,
        slug: table.slug,
        title: table.title,
        description: table.description ?? "",
        isActive: table.isActive,
        order: table.order,
        subjectRef: table.subjectRef ?? "",
        columns: table.columns.map((column) => ({
            key: column.id,
            label: column.label,
            subtitle: column.subtitle ?? "",
            href: column.href ?? "",
            highlight: column.highlight,
        })),
        groups: table.groups.map((group) => ({ key: group.id, label: group.label })),
        rows: table.rows.map((row) => ({ key: row.id, groupKey: row.groupId ?? "", label: row.label })),
        cells,
    };
}

export default function ComparisonTablesAdminPage() {
    const t = useTranslations("comparisonTable");
    const commonT = useTranslations("common");
    const { confirm } = useConfirm();

    const [tables, setTables] = useState<StoredTable[]>([]);
    // The title and the address: the two the row draws.
    const list = useRowList(tables, { text: (row) => [row.title, row.slug], pageSize: 15 });
    const [subjects, setSubjects] = useState<{ ref: string; label: string; group: string }[]>([]);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [saving, setSaving] = useState(false);

    // What a table can be about. Asked once: it is a list of shelves, and an
    // operator opening this screen is about to need it.
    useEffect(() => {
        let cancelled = false;
        fetch("/api/v1/comparison-tables/admin/subjects")
            // `Promise.reject`, not an empty list: a refusal that becomes
            // `{ subjects: [] }` never reaches the catch, and the operator is
            // shown a site with nothing to compare rather than a failure.
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((data: { subjects?: { ref: string; label: string; group: string }[] }) => {
                if (!cancelled) setSubjects(data.subjects ?? []);
            })
            // An empty picker and a picker that could not be read look the
            // same, and the second one is an operator wondering why their
            // shelves are not listed.
            .catch(() => { if (!cancelled) toast.error(t("adm_subjectsFailed")); });
        return () => { cancelled = true; };
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try {
            const res = await fetch("/api/v1/comparison-tables/admin/tables");
            if (!res.ok) throw new Error("read");
            const body = await res.json();
            setTables(body.tables ?? []);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const save = async () => {
        if (!draft) return;
        setSaving(true);
        try {
            const cells: DraftCell[] = draft.rows.flatMap((row) =>
                draft.columns.map((column) => {
                    const held = draft.cells[at(row.key, column.key)];
                    return {
                        rowId: row.key,
                        columnId: column.key,
                        kind: held?.kind ?? "unstated",
                        value: held?.value ?? null,
                    };
                }),
            );
            const res = await fetch("/api/v1/comparison-tables/admin/tables", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: draft.id,
                    slug: draft.slug.trim(),
                    title: draft.title.trim(),
                    description: draft.description.trim() || null,
                    isActive: draft.isActive,
                    order: draft.order,
                    subjectRef: draft.subjectRef || null,
                    columns: draft.columns,
                    groups: draft.groups,
                    rows: draft.rows.map((row) => ({ key: row.key, groupKey: row.groupKey || null, label: row.label })),
                    cells: cells.map((cell) => ({
                        rowKey: cell.rowId,
                        columnKey: cell.columnId,
                        kind: cell.kind,
                        value: cell.value,
                    })),
                }),
            });
            const wrong = await writeError(res, t("adm_saveFailed"), t);
            if (wrong) {
                toast.error(wrong);
                return;
            }
            toast.success(t("adm_saved"));
            setDraft(null);
            await load();
        } catch {
            toast.error(t("adm_saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <Card><CardContent className="py-10 text-center text-muted-foreground">{commonT("loading")}</CardContent></Card>;
    }
    if (failed) {
        return (
            <>
                <AdminPageHeader title={t("adm_title")} description={t("adm_subtitle")} />
                <Card><CardContent><LoadFailed onRetry={load} /></CardContent></Card>
            </>
        );
    }

    if (!draft) {
        return (
            <>
                <AdminPageHeader
                    title={t("adm_title")}
                    description={t("adm_subtitle")}
                    actions={
                        <Button onClick={() => setDraft({ ...EMPTY, cells: {} })}>
                            <Plus className="w-4 h-4" aria-hidden="true" />
                            {t("adm_newTable")}
                        </Button>
                    }
                />
                <Card>
                    <CardContent className="p-0">
                        <ListControls className="mb-4" search={{ value: list.search, onChange: list.setSearch }} />

                        {tables.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-10">{t("adm_noTables")}</p>
                        ) : list.rows.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-10">{commonT("noResults")}</p>
                        ) : (
                            <div className="divide-y">
                                {list.rows.map((table) => (
                                    <div key={table.id} className="flex items-center gap-3 p-4">
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium">{table.title}</p>
                                            <p className="text-xs text-muted-foreground">
                                                /{table.slug}
                                                {" - "}
                                                {t("adm_size", { columns: table.columns.length, rows: table.rows.length })}
                                                {!table.isActive ? ` - ${t("adm_off")}` : ""}
                                            </p>
                                        </div>
                                        <Button variant="outline" size="sm" onClick={() => setDraft(toDraft(table))}>
                                            {t("adm_edit")}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            aria-label={t("adm_delete")}
                                            onClick={async () => {
                                                const sure = await confirm({
                                                    title: t("adm_delete"),
                                                    message: t("adm_deleteConfirm"),
                                                    variant: "danger",
                                                });
                                                if (!sure) return;
                                                const res = await fetch("/api/v1/comparison-tables/admin/tables", {
                                                    method: "DELETE",
                                                    headers: { "Content-Type": "application/json" },
                                                    body: JSON.stringify({ id: table.id }),
                                                });
                                                const wrong = await writeError(res, t("adm_saveFailed"), t);
                                                if (wrong) { toast.error(wrong); return; }
                                                toast.success(t("adm_deleted"));
                                                await load();
                                            }}
                                        >
                                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                                        </Button>
                                    </div>
                                ))}
                                <Pagination
                                    page={list.page}
                                    pages={list.pages}
                                    total={list.total}
                                    onPageChange={list.setPage}
                                />
                            </div>
                        )}
                    </CardContent>
                </Card>
            </>
        );
    }

    const setCell = (rowKey: string, columnKey: string, next: Partial<{ kind: CellKind; value: string }>) => {
        const key = at(rowKey, columnKey);
        const held = draft.cells[key] ?? { kind: "unstated" as CellKind, value: "" };
        setDraft({ ...draft, cells: { ...draft.cells, [key]: { ...held, ...next } } });
    };

    return (
        <>
            <AdminPageHeader
                title={draft.id ? t("adm_editTable") : t("adm_newTable")}
                description={t("adm_cellHint")}
                onBack={() => setDraft(null)}
                backLabel={commonT("back")}
                actions={
                    <Button onClick={save} disabled={saving || draft.title.trim() === "" || draft.slug.trim() === ""}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Check className="w-4 h-4" aria-hidden="true" />}
                        {t("adm_save")}
                    </Button>
                }
            />

            <Card className="mb-6">
                <CardContent className="p-4 grid sm:grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="table-title">{t("adm_tableTitle")}</Label>
                        <Input id="table-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                    </div>
                    <div>
                        <Label htmlFor="table-slug">{t("adm_tableSlug")}</Label>
                        <Input id="table-slug" value={draft.slug} placeholder="plans" onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                        <Label htmlFor="table-desc">{t("adm_tableDescription")}</Label>
                        <Textarea id="table-desc" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                        <Label htmlFor="table-subject">{t("adm_subject")}</Label>
                        <NativeSelect
                            id="table-subject"
                            value={draft.subjectRef}
                            onChange={(e) => setDraft({ ...draft, subjectRef: e.target.value })}
                        >
                            <option value="">{t("adm_subjectNone")}</option>
                            {subjects.map((subject) => (
                                <option key={subject.ref} value={subject.ref}>{subject.label}</option>
                            ))}
                        </NativeSelect>
                        <p className="mt-1 text-xs text-muted-foreground">{t("adm_subjectHint")}</p>
                    </div>
                </CardContent>
            </Card>

            <Card className="mb-6">
                <CardHeader>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <CardTitle>{t("adm_columns")}</CardTitle>
                        {/* A table about a subject does not own its columns:
                            they are the things inside it, and they arrive and
                            leave as that shelf changes. Offering Add here
                            would be offering to write a column the next read
                            takes straight back out. */}
                        {!draft.subjectRef && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDraft({
                                    ...draft,
                                    columns: [...draft.columns, { key: newKey("c"), label: "", subtitle: "", href: "", highlight: false }],
                                })}
                            >
                                <Plus className="w-4 h-4" aria-hidden="true" />
                                {t("adm_addColumn")}
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="space-y-2">
                    {draft.subjectRef && (
                        <p className="text-sm text-muted-foreground">{t("adm_columnsFromSubject")}</p>
                    )}
                    {draft.columns.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("adm_noColumns")}</p>
                    ) : draft.subjectRef ? (
                        <ul className="flex flex-wrap gap-2">
                            {draft.columns.map((column) => (
                                <li key={column.key} className="rounded-md border border-border bg-muted/40 px-3 py-1 text-sm">
                                    {column.label}
                                </li>
                            ))}
                        </ul>
                    ) : draft.columns.map((column, index) => (
                        <div key={column.key} className="flex items-center gap-2 flex-wrap">
                            <Input
                                value={column.label}
                                aria-label={t("adm_columnLabel")}
                                placeholder={t("adm_columnLabel")}
                                className="flex-1 min-w-[8rem]"
                                onChange={(e) => setDraft({
                                    ...draft,
                                    columns: draft.columns.map((c, i) => (i === index ? { ...c, label: e.target.value } : c)),
                                })}
                            />
                            <Input
                                value={column.href}
                                aria-label={t("adm_columnHref")}
                                placeholder={t("adm_columnHref")}
                                className="flex-1 min-w-[8rem]"
                                onChange={(e) => setDraft({
                                    ...draft,
                                    columns: draft.columns.map((c, i) => (i === index ? { ...c, href: e.target.value } : c)),
                                })}
                            />
                            <Button
                                variant="ghost"
                                size="sm"
                                aria-label={t("adm_removeColumn", { label: column.label })}
                                onClick={() => setDraft({ ...draft, columns: draft.columns.filter((_, i) => i !== index) })}
                            >
                                <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </Button>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <CardTitle>{t("adm_rows")}</CardTitle>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDraft({ ...draft, groups: [...draft.groups, { key: newKey("g"), label: "" }] })}
                            >
                                <Plus className="w-4 h-4" aria-hidden="true" />
                                {t("adm_addGroup")}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDraft({ ...draft, rows: [...draft.rows, { key: newKey("r"), groupKey: "", label: "" }] })}
                            >
                                <Plus className="w-4 h-4" aria-hidden="true" />
                                {t("adm_addRow")}
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    {draft.groups.map((group, index) => (
                        <div key={group.key} className="flex items-center gap-2">
                            <Input
                                value={group.label}
                                aria-label={t("adm_groupLabel")}
                                placeholder={t("adm_groupLabel")}
                                onChange={(e) => setDraft({
                                    ...draft,
                                    groups: draft.groups.map((g, i) => (i === index ? { ...g, label: e.target.value } : g)),
                                })}
                            />
                            <Button
                                variant="ghost"
                                size="sm"
                                aria-label={t("adm_removeGroup", { label: group.label })}
                                onClick={() => setDraft({ ...draft, groups: draft.groups.filter((_, i) => i !== index) })}
                            >
                                <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </Button>
                        </div>
                    ))}

                    {draft.rows.length === 0 || draft.columns.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("adm_needBoth")}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b">
                                        <th className="text-left py-2 pr-3 font-medium text-muted-foreground">{t("adm_feature")}</th>
                                        <th className="text-left py-2 px-2 font-medium text-muted-foreground">{t("adm_group")}</th>
                                        {draft.columns.map((column) => (
                                            <th key={column.key} className="text-left py-2 px-2 font-medium text-muted-foreground">
                                                {column.label || t("adm_columnLabel")}
                                            </th>
                                        ))}
                                        <th />
                                    </tr>
                                </thead>
                                <tbody>
                                    {draft.rows.map((row, index) => (
                                        <tr key={row.key} className="border-b last:border-0">
                                            <td className="py-2 pr-3">
                                                <Input
                                                    value={row.label}
                                                    aria-label={t("adm_rowLabel")}
                                                    onChange={(e) => setDraft({
                                                        ...draft,
                                                        rows: draft.rows.map((r, i) => (i === index ? { ...r, label: e.target.value } : r)),
                                                    })}
                                                />
                                            </td>
                                            <td className="py-2 px-2">
                                                <NativeSelect
                                                    value={row.groupKey}
                                                    aria-label={t("adm_group")}
                                                    onChange={(e) => setDraft({
                                                        ...draft,
                                                        rows: draft.rows.map((r, i) => (i === index ? { ...r, groupKey: e.target.value } : r)),
                                                    })}
                                                >
                                                    <option value="">{t("adm_noGroup")}</option>
                                                    {draft.groups.map((group) => (
                                                        <option key={group.key} value={group.key}>{group.label || t("adm_groupLabel")}</option>
                                                    ))}
                                                </NativeSelect>
                                            </td>
                                            {draft.columns.map((column) => {
                                                const held = draft.cells[at(row.key, column.key)] ?? { kind: "unstated" as CellKind, value: "" };
                                                return (
                                                    <td key={column.key} className="py-2 px-2">
                                                        <div className="flex items-center gap-1">
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                aria-label={t(`adm_cell_${held.kind}`)}
                                                                onClick={() => setCell(row.key, column.key, { kind: NEXT[held.kind] })}
                                                            >
                                                                {held.kind === "yes" ? <Check className="w-4 h-4 text-success" aria-hidden="true" />
                                                                    : held.kind === "no" ? <X className="w-4 h-4 text-destructive" aria-hidden="true" />
                                                                    : held.kind === "value" ? <Type className="w-4 h-4" aria-hidden="true" />
                                                                    : <Minus className="w-4 h-4 text-muted-foreground" aria-hidden="true" />}
                                                            </Button>
                                                            {held.kind === "value" && (
                                                                <Input
                                                                    value={held.value}
                                                                    aria-label={t("adm_cellValue")}
                                                                    className="w-24"
                                                                    onChange={(e) => setCell(row.key, column.key, { value: e.target.value })}
                                                                />
                                                            )}
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                            <td className="py-2 pl-2">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    aria-label={t("adm_removeRow", { label: row.label })}
                                                    onClick={() => setDraft({ ...draft, rows: draft.rows.filter((_, i) => i !== index) })}
                                                >
                                                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </>
    );
}
