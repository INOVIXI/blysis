"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    Badge, Button, Card, CardContent, Checkbox, Input, Label, LoadFailed,
    NativeSelect, useConfirm,
} from "@/core/sdk/ui";
import { AdminPageHeader, RowActions } from "@/core/sdk/admin";
import { Plus, Save, Trash2 } from "lucide-react";
import { STATE_TONES, stateLabel, type TicketState } from "../../../../lib/ticket-states";

/**
 * What states this desk names its tickets with.
 *
 * Five statuses and four priorities were Prisma enums, so a desk that triages
 * into "First line" and "With the developers" could not say so and one that
 * never resolves anything could not take RESOLVED away. Adding a value to a
 * database type is a migration, not a setting.
 *
 * Its own screen rather than a panel on the ticket list: the punishments
 * module put its places manager at the top of the new-punishment form and
 * that is the whole of why that screen could not be worked out.
 */

interface StateRow extends TicketState {
    id: string;
    order: number;
}

type Kind = "status" | "priority";

const COLUMNS = "gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem_auto_13rem]";

export default function TicketStatesPage() {
    const t = useTranslations("tickets");
    const commonT = useTranslations("common");
    const { confirm } = useConfirm();
    const [statuses, setStatuses] = useState<StateRow[]>([]);
    const [priorities, setPriorities] = useState<StateRow[]>([]);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [saving, setSaving] = useState<string | null>(null);
    const [draft, setDraft] = useState<{ kind: Kind; key: string; name: string; tone: string } | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch("/api/v1/tickets/states");
            if (!res.ok) throw new Error(String(res.status));
            const body = await res.json();
            setStatuses(body.statuses ?? []);
            setPriorities(body.priorities ?? []);
            setFailed(false);
        } catch {
            // A read that failed and a desk with no states look identical on
            // screen, and only one of them is worth retrying.
            setFailed(true);
        }
    }, []);

    useEffect(() => { load(); }, [load, reloadKey]);

    const write = async (method: "POST" | "PATCH" | "DELETE", body: unknown, id: string) => {
        setSaving(id);
        try {
            const res = await fetch("/api/v1/tickets/states", {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const said = await res.json().catch(() => null) as { code?: string } | null;
                toast.error(said?.code === "key_taken" ? t("adm_stateTaken") : t("adm_stateSaveFailed"));
                return false;
            }
            toast.success(method === "DELETE" ? t("adm_stateDeleted") : t("adm_stateSaved"));
            await load();
            return true;
        } finally {
            setSaving(null);
        }
    };

    const remove = async (kind: Kind, state: StateRow) => {
        const sure = await confirm({
            title: t("adm_stateDeleteTitle"),
            message: t("adm_stateDeleteConfirm"),
            confirmText: commonT("delete"),
            variant: "danger",
        });
        if (sure) await write("DELETE", { kind, id: state.id }, state.id);
    };

    const rows = (kind: Kind, states: StateRow[]) => (
        <>
            <div
                aria-hidden="true"
                className={`hidden md:grid ${COLUMNS} pb-1 text-sm font-medium leading-none`}
            >
                <span>{t("adm_stateKey")}</span>
                <span>{t("adm_stateName")}</span>
                <span>{t("adm_stateTone")}</span>
                <span>{kind === "status" ? t("adm_stateOpen") : ""}</span>
                <span />
            </div>
            {states.map((state) => (
                <div key={state.id} className={`grid ${COLUMNS} md:items-center`}>
                    <div>
                        <Label className="md:hidden">{t("adm_stateKey")}</Label>
                        {/* Read-only: a ticket records this string, so changing
                            it would orphan every ticket already in it. */}
                        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
                            {state.key}
                        </p>
                    </div>
                    <div>
                        <Label className="md:hidden">{t("adm_stateName")}</Label>
                        <Input
                            aria-label={t("adm_stateName")}
                            defaultValue={stateLabel(t, state.key, states)}
                            onBlur={(e) => {
                                const name = e.target.value.trim();
                                if (name && name !== stateLabel(t, state.key, states)) {
                                    write("PATCH", { kind, id: state.id, name }, state.id);
                                }
                            }}
                        />
                    </div>
                    <div>
                        <Label className="md:hidden">{t("adm_stateTone")}</Label>
                        <NativeSelect
                            aria-label={t("adm_stateTone")}
                            className="w-full"
                            value={state.tone}
                            onChange={(e) => write("PATCH", { kind, id: state.id, tone: e.target.value }, state.id)}
                        >
                            {STATE_TONES.map((tone) => (
                                <option key={tone} value={tone}>{t(`adm_tone_${tone}`)}</option>
                            ))}
                        </NativeSelect>
                    </div>
                    <div>
                        {kind === "status" && (
                            /* The column above says what this is; the box
                               said it again beside every row. */
                            <Checkbox
                                checked={state.isOpen !== false}
                                onChange={(e) => write("PATCH", { kind, id: state.id, isOpen: e.target.checked }, state.id)}
                                aria-label={t("adm_stateOpen")}
                            />
                        )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                        <Badge tone={state.tone as "neutral"} className="max-w-full truncate">
                            {stateLabel(t, state.key, states)}
                        </Badge>
                        <RowActions
                            actions={[{
                                icon: Trash2,
                                label: commonT("delete"),
                                onClick: () => remove(kind, state),
                                destructive: true,
                                disabled: saving === state.id,
                            }]}
                        />
                    </div>
                </div>
            ))}
        </>
    );

    return (
        <>
            <AdminPageHeader
                title={t("adm_states")}
                description={t("adm_statesHint")}
                actions={
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDraft({ kind: "status", key: "", name: "", tone: "neutral" })}
                        disabled={draft !== null}
                    >
                        <Plus className="w-4 h-4" /> {t("adm_addState")}
                    </Button>
                }
            />

            {failed ? (
                <LoadFailed onRetry={() => setReloadKey((k) => k + 1)} />
            ) : (
                <div className="space-y-6">
                    <Card>
                        <CardContent className="p-4 space-y-3">
                            <h2 className="text-sm font-medium">{t("adm_statuses")}</h2>
                            {rows("status", statuses)}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-4 space-y-3">
                            <h2 className="text-sm font-medium">{t("adm_priorities")}</h2>
                            {rows("priority", priorities)}
                        </CardContent>
                    </Card>

                    {draft && (
                        <Card>
                            <CardContent className="p-4 space-y-3">
                                <div className={`grid ${COLUMNS} md:items-center`}>
                                    <div>
                                        <Label className="md:hidden">{t("adm_stateKey")}</Label>
                                        <Input
                                            aria-label={t("adm_stateKey")}
                                            value={draft.key}
                                            onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                                            placeholder="with-dev"
                                        />
                                        <p className="mt-1 text-xs text-muted-foreground">{t("adm_stateKeyHint")}</p>
                                    </div>
                                    <div>
                                        <Label className="md:hidden">{t("adm_stateName")}</Label>
                                        <Input
                                            aria-label={t("adm_stateName")}
                                            value={draft.name}
                                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <Label className="md:hidden">{t("adm_stateTone")}</Label>
                                        <NativeSelect
                                            aria-label={t("adm_stateTone")}
                                            className="w-full"
                                            value={draft.tone}
                                            onChange={(e) => setDraft({ ...draft, tone: e.target.value })}
                                        >
                                            {STATE_TONES.map((tone) => (
                                                <option key={tone} value={tone}>{t(`adm_tone_${tone}`)}</option>
                                            ))}
                                        </NativeSelect>
                                    </div>
                                    <div>
                                        <NativeSelect
                                            aria-label={t("adm_stateKind")}
                                            className="w-full"
                                            value={draft.kind}
                                            onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })}
                                        >
                                            <option value="status">{t("adm_statuses")}</option>
                                            <option value="priority">{t("adm_priorities")}</option>
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
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}
        </>
    );
}
