"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    Badge, Button, Card, CardContent, Input, Label, LoadFailed,
    NativeSelect, useConfirm,
} from "@/core/sdk/ui";
import { AdminPageHeader, RowActions } from "@/core/sdk/admin";
import { Plus, Save, Trash2 } from "lucide-react";
import { CHANGELOG_TONES, changelogKindLabel, type ChangelogKind } from "../../../lib/types";

/**
 * What a release can be called here.
 *
 * Six kinds were an array in the source, with a colour and a translation key
 * each. Six good words, and six is not every community's six: nobody could
 * add "Known issue" or "Map reset", and none of the six could be taken away.
 *
 * Its own screen rather than a panel on the form that writes a release -
 * the punishments module put its places manager at the top of the
 * new-punishment form and that is the whole of why that screen could not be
 * worked out.
 */

interface Kind extends ChangelogKind {
    id: string;
    order: number;
}

/**
 * One template for every row, and the names of the columns above them once.
 *
 * The last column held a badge whose width is the length of the word inside
 * it, so with `auto` there it was a different width on every row and the two
 * flexible columns beside it moved with it: six rows, six left edges, a list
 * that reads as though it were six unrelated forms stacked. The column is
 * given a width instead, and the badge is clipped rather than allowed to set
 * one.
 */
const COLUMNS = "gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_13rem]";

export default function ChangelogTypesPage() {
    const t = useTranslations("changelog");
    const commonT = useTranslations("common");
    const { confirm } = useConfirm();
    const [kinds, setKinds] = useState<Kind[]>([]);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [saving, setSaving] = useState<string | null>(null);
    const [draft, setDraft] = useState<{ key: string; name: string; tone: string } | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/v1/changelog/types");
            if (!res.ok) throw new Error(String(res.status));
            const body = await res.json();
            setKinds(body.types ?? []);
            setFailed(false);
        } catch {
            // A read that failed and a site with no kinds look identical on
            // screen, and only one of them is worth retrying.
            setFailed(true);
        }
    }, []);

    useEffect(() => { load(); }, [load, reloadKey]);

    const write = async (method: "POST" | "PATCH" | "DELETE", body: unknown, id: string) => {
        setSaving(id);
        try {
            const res = await fetch("/api/v1/changelog/types", {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const said = await res.json().catch(() => null) as { code?: string } | null;
                toast.error(said?.code === "key_taken" ? t("adm_kindTaken") : t("adm_kindSaveFailed"));
                return false;
            }
            toast.success(method === "DELETE" ? t("adm_kindDeleted") : t("adm_kindSaved"));
            await load();
            return true;
        } finally {
            setSaving(null);
        }
    };

    const remove = async (kind: Kind) => {
        const sure = await confirm({
            title: t("adm_kindDeleteTitle"),
            message: t("adm_kindDeleteConfirm"),
            confirmText: commonT("delete"),
            variant: "danger",
        });
        if (sure) await write("DELETE", { id: kind.id }, kind.id);
    };

    return (
        <>
            <AdminPageHeader
                title={t("adm_kinds")}
                description={t("adm_kindsHint")}
                actions={
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDraft({ key: "", name: "", tone: "neutral" })}
                        disabled={draft !== null}
                    >
                        <Plus className="w-4 h-4" /> {t("adm_addKind")}
                    </Button>
                }
            />

            {failed ? (
                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
            ) : (
                <Card>
                    <CardContent className="p-4 space-y-3">
                        {kinds.length === 0 && draft === null ? (
                            <p className="text-sm text-muted-foreground">{t("adm_kindsNone")}</p>
                        ) : null}

                        {kinds.length > 0 || draft ? (
                            <div
                                aria-hidden="true"
                                className={`hidden md:grid ${COLUMNS} pb-1 text-sm font-medium leading-none`}
                            >
                                <span>{t("adm_kindKey")}</span>
                                <span>{t("adm_kindName")}</span>
                                <span>{t("adm_kindTone")}</span>
                                <span />
                            </div>
                        ) : null}

                        {kinds.map((kind) => (
                            <div key={kind.id} className={`grid ${COLUMNS} md:items-center`}>
                                <div>
                                    <Label className="md:hidden">{t("adm_kindKey")}</Label>
                                    {/* Read-only: a release records this
                                        string, so changing it would orphan
                                        every one already written. */}
                                    <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
                                        {kind.key}
                                    </p>
                                </div>
                                <div>
                                    <Label className="md:hidden">{t("adm_kindName")}</Label>
                                    <Input
                                        aria-label={t("adm_kindName")}
                                        defaultValue={changelogKindLabel(t, kind.key, kinds)}
                                        onBlur={(e) => {
                                            const name = e.target.value.trim();
                                            if (name && name !== changelogKindLabel(t, kind.key, kinds)) {
                                                write("PATCH", { id: kind.id, name }, kind.id);
                                            }
                                        }}
                                    />
                                </div>
                                <div>
                                    <Label className="md:hidden">{t("adm_kindTone")}</Label>
                                    <NativeSelect
                                        aria-label={t("adm_kindTone")}
                                        className="w-full"
                                        value={kind.tone}
                                        onChange={(e) => write("PATCH", { id: kind.id, tone: e.target.value }, kind.id)}
                                    >
                                        {CHANGELOG_TONES.map((tone) => (
                                            <option key={tone} value={tone}>{t(`tone_${tone}`)}</option>
                                        ))}
                                    </NativeSelect>
                                </div>
                                {/* The preview and the row's actions sit at
                                    the two ends of the column, so the delete
                                    buttons make one edge instead of following
                                    the length of each word. */}
                                <div className="flex items-center justify-between gap-2">
                                    <Badge tone={kind.tone as "neutral"} className="max-w-full truncate">
                                        {changelogKindLabel(t, kind.key, kinds)}
                                    </Badge>
                                    <RowActions
                                        actions={[{
                                            icon: Trash2,
                                            label: commonT("delete"),
                                            onClick: () => remove(kind),
                                            destructive: true,
                                            disabled: saving === kind.id,
                                        }]}
                                    />
                                </div>
                            </div>
                        ))}

                        {draft && (
                            <div className={`grid ${COLUMNS} border-t border-border pt-3 md:items-center`}>
                                <div>
                                    <Label className="md:hidden">{t("adm_kindKey")}</Label>
                                    <Input
                                        aria-label={t("adm_kindKey")}
                                        value={draft.key}
                                        onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                                        placeholder="known-issue"
                                    />
                                    <p className="mt-1 text-xs text-muted-foreground">{t("adm_kindKeyHint")}</p>
                                </div>
                                <div>
                                    <Label className="md:hidden">{t("adm_kindName")}</Label>
                                    <Input
                                        aria-label={t("adm_kindName")}
                                        value={draft.name}
                                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <Label className="md:hidden">{t("adm_kindTone")}</Label>
                                    <NativeSelect
                                        aria-label={t("adm_kindTone")}
                                        className="w-full"
                                        value={draft.tone}
                                        onChange={(e) => setDraft({ ...draft, tone: e.target.value })}
                                    >
                                        {CHANGELOG_TONES.map((tone) => (
                                            <option key={tone} value={tone}>{t(`tone_${tone}`)}</option>
                                        ))}
                                    </NativeSelect>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        size="sm"
                                        disabled={!draft.key.trim() || !draft.name.trim() || saving === "new"}
                                        onClick={async () => {
                                            const ok = await write("POST", { ...draft, key: draft.key.trim() }, "new");
                                            if (ok) setDraft(null);
                                        }}
                                    >
                                        <Save className="w-4 h-4" /> {commonT("save")}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setDraft(null)}>
                                        {commonT("cancel")}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </>
    );
}
