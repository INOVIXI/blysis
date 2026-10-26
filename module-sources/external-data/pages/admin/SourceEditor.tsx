"use client";

import { useState } from "react";
import { Loader2, Play, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Checkbox,
    Input,
    Label,
    useConfirm,
} from "@/core/sdk/ui";
import { writeError } from "@/core/sdk";

/**
 * One source: which table, which columns, and how often to ask.
 *
 * The trial run is the part that makes this usable. An operator typing a table
 * name into a production admin otherwise finds out whether it exists when a
 * visitor does. What comes back is rows, or the kind of failure - never the
 * driver's own sentence, which names the host, the user and sometimes the
 * password in full.
 *
 * Columns are typed as a comma separated list rather than picked from the
 * other database. Reading its schema means a second kind of query against
 * somebody else's server, and the names are refused unless they are names
 * either way, so the list costs the operator one line and this module one
 * fewer thing to be careful about.
 */

export interface SourceDraftValue {
    id: string | null;
    slug: string;
    title: string;
    settingKey: string;
    table: string;
    columns: string;
    orderBy: string;
    descending: boolean;
    rowLimit: number;
    cacheSeconds: number;
    isActive: boolean;
}

export const EMPTY_SOURCE: SourceDraftValue = {
    id: null, slug: "", title: "", settingKey: "", table: "", columns: "",
    orderBy: "", descending: true, rowLimit: 20, cacheSeconds: 60, isActive: true,
};

const REFUSALS: Record<string, string> = {
    source_bad_slug: "adm_errBadSlug",
    source_no_title: "adm_errNoTitle",
    source_bad_table: "adm_errBadTable",
    source_no_columns: "adm_errNoColumns",
    source_bad_column: "adm_errBadColumn",
    source_bad_order: "adm_errBadOrder",
    slug_taken: "adm_errSlugTaken",
};

const ENDPOINT = "/api/v1/external-data/admin/sources";

function payload(draft: SourceDraftValue) {
    return {
        id: draft.id,
        slug: draft.slug.trim(),
        title: draft.title.trim(),
        settingKey: draft.settingKey.trim(),
        table: draft.table.trim(),
        columns: draft.columns.split(",").map((column) => column.trim()).filter(Boolean),
        orderBy: draft.orderBy.trim(),
        descending: draft.descending,
        rowLimit: Number(draft.rowLimit) || 20,
        cacheSeconds: Number(draft.cacheSeconds) || 60,
        isActive: draft.isActive,
    };
}

interface SourceEditorProps {
    value: SourceDraftValue;
    onChange: (value: SourceDraftValue) => void;
    onSaved: () => void;
    onCancel: () => void;
}

export function SourceEditor({ value, onChange, onSaved, onCancel }: SourceEditorProps) {
    const t = useTranslations("externalData");
    const commonT = useTranslations("common");
    const { confirm } = useConfirm();
    const [busy, setBusy] = useState<"save" | "try" | null>(null);
    const [tried, setTried] = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null);

    const explain = async (res: Response, fallback: string) => {
        const body = await res.json().catch(() => null);
        const key = typeof body?.code === "string" ? REFUSALS[body.code] : undefined;
        return key ? t(key) : (await writeError(res.clone(), fallback, t)) ?? fallback;
    };

    const save = async () => {
        setBusy("save");
        try {
            const res = await fetch(ENDPOINT, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload(value)),
            });
            if (!res.ok) {
                toast.error(await explain(res, t("adm_saveFailed")));
                return;
            }
            toast.success(t("adm_saved"));
            onSaved();
        } catch {
            toast.error(t("adm_saveFailed"));
        } finally {
            setBusy(null);
        }
    };

    const tryIt = async () => {
        setBusy("try");
        setTried(null);
        try {
            const { id: _id, isActive: _isActive, ...trial } = payload(value);
            const res = await fetch(ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(trial),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok) {
                const key = typeof body?.code === "string" ? REFUSALS[body.code] : undefined;
                // The endpoint's sentence is already the reader-safe one from
                // errors.ts, so it is shown when this screen has nothing
                // better: it names the kind of failure and none of it.
                toast.error(key ? t(key) : (body?.error ?? t("adm_tryFailed")));
                return;
            }
            setTried({ columns: body.columns ?? [], rows: body.rows ?? [] });
            toast.success(t("adm_tryWorked", { count: body.rows?.length ?? 0 }));
        } catch {
            toast.error(t("adm_tryFailed"));
        } finally {
            setBusy(null);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{value.id ? t("adm_editSource") : t("adm_newSource")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("adm_sourceHint")}</p>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="source-title">{t("adm_sourceTitle")}</Label>
                        <Input id="source-title" value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} />
                    </div>
                    <div>
                        <Label htmlFor="source-slug">{t("adm_sourceSlug")}</Label>
                        <Input id="source-slug" value={value.slug} placeholder="leaderboard" onChange={(e) => onChange({ ...value, slug: e.target.value })} />
                    </div>
                    <div>
                        <Label htmlFor="source-table">{t("adm_sourceTable")}</Label>
                        <Input id="source-table" value={value.table} placeholder="players" onChange={(e) => onChange({ ...value, table: e.target.value })} />
                    </div>
                    <div>
                        <Label htmlFor="source-columns">{t("adm_sourceColumns")}</Label>
                        <Input id="source-columns" value={value.columns} placeholder="name, score" onChange={(e) => onChange({ ...value, columns: e.target.value })} />
                        <p className="text-xs text-muted-foreground mt-1">{t("adm_sourceColumnsHint")}</p>
                    </div>
                    <div>
                        <Label htmlFor="source-order">{t("adm_sourceOrder")}</Label>
                        <Input id="source-order" value={value.orderBy} placeholder="score" onChange={(e) => onChange({ ...value, orderBy: e.target.value })} />
                    </div>
                    <div className="flex items-end gap-4">
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={value.descending} onChange={(e) => onChange({ ...value, descending: e.target.checked })} />
                            {t("adm_sourceDescending")}
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={value.isActive} onChange={(e) => onChange({ ...value, isActive: e.target.checked })} />
                            {t("adm_sourceActive")}
                        </label>
                    </div>
                    <div>
                        <Label htmlFor="source-rows">{t("adm_sourceRows")}</Label>
                        <Input id="source-rows" type="number" min={1} max={1000} value={value.rowLimit} onChange={(e) => onChange({ ...value, rowLimit: Number(e.target.value) })} />
                    </div>
                    <div>
                        <Label htmlFor="source-cache">{t("adm_sourceCache")}</Label>
                        <Input id="source-cache" type="number" min={5} max={86400} value={value.cacheSeconds} onChange={(e) => onChange({ ...value, cacheSeconds: Number(e.target.value) })} />
                        <p className="text-xs text-muted-foreground mt-1">{t("adm_sourceCacheHint")}</p>
                    </div>
                </div>

                {tried && (
                    <div className="border border-border rounded-lg p-3 overflow-x-auto">
                        <p className="text-xs text-muted-foreground mb-2">{t("adm_tryTitle")}</p>
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b">
                                    {tried.columns.map((column) => (
                                        <th key={column} className="text-left py-1 pr-4 font-medium text-muted-foreground">{column}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {tried.rows.map((row, index) => (
                                    <tr key={index} className="border-b last:border-0">
                                        {tried.columns.map((column) => (
                                            <td key={column} className="py-1 pr-4">{String(row[column] ?? "")}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {tried.rows.length === 0 && (
                            <p className="text-sm text-muted-foreground">{t("adm_tryEmpty")}</p>
                        )}
                    </div>
                )}

                <div className="flex justify-between gap-2 flex-wrap">
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onCancel} disabled={busy !== null}>
                            {commonT("cancel")}
                        </Button>
                        {value.id && (
                            <Button
                                variant="ghost"
                                disabled={busy !== null}
                                onClick={async () => {
                                    const sure = await confirm({
                                        title: t("adm_deleteSource"),
                                        message: t("adm_deleteConfirm"),
                                        variant: "danger",
                                    });
                                    if (!sure) return;
                                    const res = await fetch(ENDPOINT, {
                                        method: "DELETE",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ id: value.id }),
                                    });
                                    const wrong = await writeError(res, t("adm_saveFailed"), t);
                                    if (wrong) { toast.error(wrong); return; }
                                    toast.success(t("adm_deleted"));
                                    onSaved();
                                }}
                            >
                                <Trash2 className="w-4 h-4" aria-hidden="true" />
                                {t("adm_deleteSource")}
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={tryIt} disabled={busy !== null}>
                            {busy === "try" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Play className="w-4 h-4" aria-hidden="true" />}
                            {t("adm_try")}
                        </Button>
                        <Button onClick={save} disabled={busy !== null}>
                            {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
                            {t("adm_saveSource")}
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
