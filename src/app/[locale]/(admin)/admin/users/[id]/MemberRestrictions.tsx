"use client";

import { useState } from "react";
import { Loader2, Plus, Undo2 } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/core/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import { dateLocaleTag, formatDate } from "@/core/lib/utils";
import { SITE_WIDE } from "@/core/lib/restrictions";
import { errorMessage } from "@/core/lib/write-result";

/**
 * Keeping one member out of one part of the site, from the screen about them.
 *
 * A restriction belongs to a person, not to a list of restrictions, which is
 * why this is here rather than on a screen of its own: the operator deciding
 * whether somebody should be out of the tickets for a week is already looking
 * at what that somebody has done.
 *
 * The scope box takes free text and suggests what this site has already used.
 * Core cannot offer a list - `tickets` and `comments` are the names of
 * modules, and a fixed list here would be core knowing which ones exist - so
 * the suggestions come from the rows, and anything an installed module asks
 * about can be typed.
 */

export interface RestrictionRow {
    id: string;
    scope: string;
    reason: string | null;
    expiresAt: string | null;
    createdAt: string;
}

interface MemberRestrictionsProps {
    userId: string;
    restrictions: RestrictionRow[];
    scopes: string[];
    onChange: (restrictions: RestrictionRow[]) => void;
}

const REFUSALS: Record<string, string> = {
    restriction_empty_scope: "restrictions_errEmptyScope",
    restriction_already_lapsed: "restrictions_errAlreadyLapsed",
    restriction_too_long: "restrictions_errTooLong",
};

function lapsed(row: RestrictionRow): boolean {
    return row.expiresAt !== null && new Date(row.expiresAt).getTime() <= Date.now();
}

export function MemberRestrictions({ userId, restrictions, scopes, onChange }: MemberRestrictionsProps) {
    const t = useTranslations("admin");
    const dateTag = dateLocaleTag(useLocale());

    const [open, setOpen] = useState(false);
    const [scope, setScope] = useState("");
    const [reason, setReason] = useState("");
    const [until, setUntil] = useState("");
    const [busy, setBusy] = useState(false);

    const send = async (method: "POST" | "PATCH", body: Record<string, unknown>) => {
        setBusy(true);
        try {
            const res = await fetch(`/api/v1/admin/customers/${userId}/restrictions`, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const answer = await res.json();
            if (!answer.ok) {
                const key = typeof answer.code === "string" ? REFUSALS[answer.code] : undefined;
                toast.error(key ? t(key) : errorMessage(answer, t("restrictions_errGeneric"), t));
                return false;
            }
            onChange(answer.data.restrictions as RestrictionRow[]);
            return true;
        } catch {
            toast.error(t("restrictions_errGeneric"));
            return false;
        } finally {
            setBusy(false);
        }
    };

    const place = async () => {
        const done = await send("POST", {
            scope,
            reason: reason || null,
            // A local datetime box gives no zone. Read on this browser's
            // clock, which is the operator's, and sent as an instant.
            expiresAt: until ? new Date(until).toISOString() : null,
        });
        if (!done) return;
        toast.success(t("restrictions_placed"));
        setOpen(false);
        setScope("");
        setReason("");
        setUntil("");
    };

    const live = restrictions.filter((row) => !lapsed(row));
    const history = restrictions.filter(lapsed);

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle>{t("restrictions_title")}</CardTitle>
                    <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
                        <Plus className="w-4 h-4" aria-hidden="true" />
                        {t("restrictions_place")}
                    </Button>
                </div>
                <p className="text-sm text-muted-foreground">{t("restrictions_hint")}</p>
            </CardHeader>
            <CardContent className="space-y-4">
                {open && (
                    <div className="space-y-3 border border-border rounded-lg p-3">
                        <div>
                            <Label htmlFor="restriction-scope">{t("restrictions_scope")}</Label>
                            <Input
                                id="restriction-scope"
                                list="restriction-scopes"
                                value={scope}
                                placeholder={t("restrictions_scopePlaceholder")}
                                onChange={(event) => setScope(event.target.value)}
                            />
                            <datalist id="restriction-scopes">
                                {[SITE_WIDE, ...scopes.filter((s) => s !== SITE_WIDE)].map((s) => (
                                    <option key={s} value={s} />
                                ))}
                            </datalist>
                        </div>
                        <div>
                            <Label htmlFor="restriction-reason">{t("restrictions_reason")}</Label>
                            <Input
                                id="restriction-reason"
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                            />
                        </div>
                        <div>
                            <Label htmlFor="restriction-until">{t("restrictions_until")}</Label>
                            <Input
                                id="restriction-until"
                                type="datetime-local"
                                value={until}
                                onChange={(event) => setUntil(event.target.value)}
                            />
                            <p className="text-xs text-muted-foreground mt-1">{t("restrictions_untilHint")}</p>
                        </div>
                        <div className="flex justify-end">
                            <Button size="sm" disabled={busy || scope.trim() === ""} onClick={place}>
                                {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                                {t("restrictions_place")}
                            </Button>
                        </div>
                    </div>
                )}

                {live.length === 0 && history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("restrictions_none")}</p>
                ) : null}

                {live.map((row) => (
                    <div key={row.id} className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                            <p className="font-medium">{row.scope}</p>
                            <p className="text-xs text-muted-foreground">
                                {row.expiresAt
                                    ? t("restrictions_untilDate", { date: formatDate(new Date(row.expiresAt), undefined, dateTag) })
                                    : t("restrictions_noEnd")}
                                {row.reason ? ` - ${row.reason}` : ""}
                            </p>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={async () => {
                                if (await send("PATCH", { restrictionId: row.id })) toast.success(t("restrictions_lifted"));
                            }}
                        >
                            <Undo2 className="w-4 h-4" aria-hidden="true" />
                            {t("restrictions_lift")}
                        </Button>
                    </div>
                ))}

                {history.length > 0 && (
                    <div className="pt-2 border-t border-border">
                        {/* Lapsed rows stay on purpose: an operator reading
                            somebody's history wants to see the month they
                            spent out of the tickets. */}
                        <p className="text-xs font-medium text-muted-foreground mb-2">{t("restrictions_past")}</p>
                        <ul className="space-y-1 text-xs text-muted-foreground">
                            {history.map((row) => (
                                <li key={row.id}>
                                    {row.scope}
                                    {" - "}
                                    {t("restrictions_endedDate", {
                                        date: formatDate(new Date(row.expiresAt as string), undefined, dateTag),
                                    })}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
