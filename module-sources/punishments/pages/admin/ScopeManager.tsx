"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    Badge,
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CheckboxField,
    Input,
    Label,
    LoadFailed,
    useConfirm,
} from "@/core/sdk/ui";
import { writeError } from "@/core/sdk";

/**
 * The places an operator divides the record into.
 *
 * Two fields and a switch, and the switch is the one that matters: whether a
 * punishment recorded here also restricts this website. It is off by default
 * and it says so in words, because the alternative - making a place and
 * finding it has closed everybody's forum account - is not something an
 * operator should discover afterwards.
 *
 * "Reported as" is the other system's word for the place and is never drawn
 * anywhere a member can see. The list of keys that have actually been arriving
 * sits under the form for the same reason a settings screen shows what is
 * connected: guessing at a game server's spelling is how an operator ends up
 * with a place that never claims anything.
 */

interface Scope {
    id: string;
    name: string;
    matchKey: string | null;
    restrictsSite: boolean;
    order: number;
    isActive: boolean;
}

interface Unclaimed {
    key: string;
    count: number;
}

const EMPTY: Omit<Scope, "id"> & { id: string | null } = {
    id: null,
    name: "",
    matchKey: "",
    restrictsSite: false,
    order: 0,
    isActive: true,
};

export function ScopeManager() {
    const t = useTranslations("punishments");
    const commonT = useTranslations("common");
    const { confirm } = useConfirm();

    const [scopes, setScopes] = useState<Scope[]>([]);
    const [unclaimed, setUnclaimed] = useState<Unclaimed[]>([]);
    const [draft, setDraft] = useState<(Omit<Scope, "id"> & { id: string | null }) | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        try {
            const res = await fetch("/api/v1/punishments/scopes");
            if (!res.ok) throw new Error("read");
            const body = await res.json();
            setScopes(body.scopes ?? []);
            setUnclaimed(body.unclaimed ?? []);
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
            const res = await fetch("/api/v1/punishments/scopes", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(draft),
            });
            const wrong = await writeError(res, t("err_invalid_scope"), t);
            if (wrong) { toast.error(wrong); return; }
            const body = await res.json();
            toast.success(t("adm_scopeSaved"));
            // Said out loud, because claiming history is the part an operator
            // would otherwise not know had happened.
            if (body.claimed > 0) toast.success(t("adm_scopeClaimed", { count: body.claimed }));
            setDraft(null);
            await load();
        } catch {
            toast.error(t("err_invalid_scope"));
        } finally {
            setSaving(false);
        }
    };

    const remove = async (id: string) => {
        if (!(await confirm({
            title: t("adm_deleteScope"),
            message: t("adm_deleteScopeConfirm"),
            confirmText: t("adm_deleteScope"),
            variant: "danger",
        }))) return;
        try {
            const res = await fetch("/api/v1/punishments/scopes", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });
            const wrong = await writeError(res, t("adm_error"), t);
            if (wrong) { toast.error(wrong); return; }
            toast.success(t("adm_scopeDeleted"));
            await load();
        } catch {
            toast.error(t("adm_error"));
        }
    };

    if (loading) {
        return <Card><CardContent className="py-10 text-center text-muted-foreground">{commonT("loading")}</CardContent></Card>;
    }
    if (failed) {
        return <Card><CardContent><LoadFailed onRetry={load} /></CardContent></Card>;
    }

    return (
        <Card className="mb-6">
            <CardHeader>
                <CardTitle>{t("adm_scopes")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("adm_scopesHint")}</p>
            </CardHeader>
            <CardContent className="space-y-4">
                {scopes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("adm_noScopes")}</p>
                ) : (
                    <div className="divide-y">
                        {scopes.map((scope) => (
                            <div key={scope.id} className="flex items-center gap-3 py-2">
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium">
                                        {scope.name}
                                        {!scope.isActive ? (
                                            <span className="text-xs text-muted-foreground"> - {t("adm_scopeOff")}</span>
                                        ) : null}
                                    </p>
                                    {scope.matchKey ? (
                                        <p className="text-xs text-muted-foreground font-mono">{scope.matchKey}</p>
                                    ) : null}
                                </div>
                                {scope.restrictsSite ? (
                                    <Badge tone="warning">{t("adm_scopeRestricts")}</Badge>
                                ) : null}
                                <Button variant="outline" size="sm" onClick={() => setDraft({ ...scope, matchKey: scope.matchKey ?? "" })}>
                                    {t("adm_saveScope")}
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => remove(scope.id)}>
                                    {t("adm_deleteScope")}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}

                {unclaimed.length > 0 ? (
                    <div className="border-t border-border pt-3">
                        <p className="text-sm font-medium">{t("adm_unclaimed")}</p>
                        <p className="text-xs text-muted-foreground mb-2">{t("adm_unclaimedHint")}</p>
                        <div className="flex flex-wrap gap-2">
                            {unclaimed.map((row) => (
                                <Button
                                    key={row.key}
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setDraft({ ...EMPTY, name: row.key, matchKey: row.key })}
                                >
                                    <span className="font-mono">{row.key}</span>
                                    <span className="text-muted-foreground">{row.count}</span>
                                </Button>
                            ))}
                        </div>
                    </div>
                ) : null}

                {draft ? (
                    <div className="border-t border-border pt-4 space-y-3">
                        <div>
                            <Label htmlFor="scope-name">{t("adm_scopeName")}</Label>
                            <Input id="scope-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                        </div>
                        <div>
                            <Label htmlFor="scope-key">{t("adm_scopeKey")}</Label>
                            <Input
                                id="scope-key"
                                value={draft.matchKey ?? ""}
                                placeholder="skyblock"
                                onChange={(e) => setDraft({ ...draft, matchKey: e.target.value })}
                            />
                            <p className="text-xs text-muted-foreground mt-1">{t("adm_scopeKeyHint")}</p>
                        </div>
                        <CheckboxField
                            label={t("adm_scopeRestricts")}
                            description={t("adm_scopeRestrictsHint")}
                            checked={draft.restrictsSite}
                            onChange={(e) => setDraft({ ...draft, restrictsSite: e.target.checked })}
                        />
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>{commonT("cancel")}</Button>
                            <Button size="sm" disabled={saving || draft.name.trim() === ""} onClick={save}>
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                                {t("adm_saveScope")}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex justify-end">
                        <Button variant="outline" size="sm" onClick={() => setDraft({ ...EMPTY })}>
                            <Plus className="w-4 h-4" aria-hidden="true" />
                            {t("adm_newScope")}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
