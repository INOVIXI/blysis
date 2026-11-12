"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
    Badge, Button, Card, CardContent, CardHeader, CardTitle, CheckboxField, Input, Label, NativeSelect, useConfirm, useLocalDateTime,
} from "@/core/sdk/ui";
import { ChevronDown, ChevronUp, Loader2, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/core/sdk";
import { REFRESH_INTERVALS, type RateFailure, type RateStatus } from "../../lib/rate-config";

interface CatalogEntry {
    id: string;
    name: string;
    host: string;
    keyField: string | null;
    cadence: "intraday" | "hourly" | "daily";
    freeRequestsPerMonth: number | null;
    covers: string[] | null;
    approximate: boolean;
}

interface SourcesForm {
    intervalMinutes: number;
    maxChangePercent: number;
    providers: { id: string; enabled: boolean }[];
    /** What the operator typed, by key field. Empty keeps the stored key. */
    keys: Record<string, string>;
    clearKeys: string[];
}

const MINUTES_PER_MONTH = 30 * 24 * 60;

/**
 * The sources payments convert with, under the rates a visitor sees.
 *
 * Kept apart from the currency list above because the two are different
 * numbers for different readers: the list is what prices are shown in and is
 * typed by the operator, these are fetched and decide what a gateway that
 * settles in another currency is charged. Each card has its own save, so
 * reordering sources never resubmits the currency list or the other way round.
 */
export function RateSources() {
    const t = useTranslations("currency");
    const commonT = useTranslations("common");
    const formatDateTime = useLocalDateTime();
    const { confirm } = useConfirm();
    const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
    const [form, setForm] = useState<SourcesForm | null>(null);
    const [keysStored, setKeysStored] = useState<string[]>([]);
    const [status, setStatus] = useState<RateStatus>({});
    const [saving, setSaving] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        const res = await fetch("/api/v1/currency/rates");
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        setCatalog(d.catalog);
        setKeysStored(d.keysStored ?? []);
        setStatus(d.status ?? {});
        setForm({ ...d.config, keys: {}, clearKeys: [] });
    }, []);

    useEffect(() => {
        load().catch(() => toast.error(t("saveError")));
    }, [load, t]);

    if (!form) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const entry = (id: string) => catalog.find((one) => one.id === id);
    const nameOf = (id: string) => entry(id)?.name ?? id;

    const move = (idx: number, by: -1 | 1) => {
        const next = [...form.providers];
        [next[idx], next[idx + by]] = [next[idx + by], next[idx]];
        setForm({ ...form, providers: next });
    };

    const failureText = (failure: RateFailure) => {
        switch (failure.code) {
            case "http": return t("rates_err_http", { status: failure.status });
            case "moved": return t("rates_err_moved", { currency: failure.currency, percent: failure.percent, limit: form.maxChangePercent });
            default: return t(`rates_err_${failure.code}`);
        }
    };

    const save = async () => {
        setSaving(true);
        try {
            const res = await fetch("/api/v1/currency/rates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    intervalMinutes: form.intervalMinutes,
                    maxChangePercent: form.maxChangePercent,
                    providers: form.providers,
                    ...form.keys,
                    clearKeys: form.clearKeys,
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                toast.error(errorMessage(data, t("saveError"), t));
                return;
            }
            toast.success(t("rates_saved"));
            await load();
        } catch {
            toast.error(t("saveError"));
        } finally {
            setSaving(false);
        }
    };

    const refreshNow = async () => {
        setRefreshing(true);
        try {
            const res = await fetch("/api/v1/currency/rates/refresh", { method: "POST" });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(errorMessage(data, t("rates_refreshFailed"), t));
            } else if (data.kind === "refreshed") {
                toast.success(t("rates_refreshed"));
            } else {
                toast.error(t("rates_refreshFailed"));
            }
            await load();
        } catch {
            toast.error(t("rates_refreshFailed"));
        } finally {
            setRefreshing(false);
        }
    };

    const callsPerMonth = Math.ceil(MINUTES_PER_MONTH / form.intervalMinutes);

    return (
        <Card className="mt-6">
            <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <CardTitle>{t("rates_title")}</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">{t("rates_subtitle")}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button type="button" variant="outline" onClick={refreshNow} disabled={refreshing || saving}>
                            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                            {t("rates_refreshNow")}
                        </Button>
                        <Button type="button" onClick={save} disabled={saving || refreshing}>
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {saving ? t("adm_saving") : commonT("save")}
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <Label htmlFor="currency-rates-interval">{t("rates_interval")}</Label>
                        <NativeSelect
                            id="currency-rates-interval"
                            className="w-full"
                            value={String(form.intervalMinutes)}
                            onChange={(e) => setForm({ ...form, intervalMinutes: Number(e.target.value) })}
                        >
                            {REFRESH_INTERVALS.map((minutes) => (
                                <option key={minutes} value={minutes}>{t(`rates_interval_${minutes}`)}</option>
                            ))}
                        </NativeSelect>
                    </div>
                    <div>
                        <Label htmlFor="currency-rates-bound">{t("rates_maxChange")}</Label>
                        <Input
                            id="currency-rates-bound"
                            type="number"
                            min="1"
                            max="100"
                            step="1"
                            value={form.maxChangePercent}
                            onChange={(e) => setForm({ ...form, maxChangePercent: Number(e.target.value) || 0 })}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">{t("rates_maxChangeHint")}</p>
                    </div>
                </div>

                <dl className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
                    <div>
                        <dt className="text-muted-foreground">{t("rates_lastSuccess")}</dt>
                        <dd>{status.lastSuccessAt ? formatDateTime(status.lastSuccessAt) : t("rates_never")}</dd>
                    </div>
                    <div>
                        <dt className="text-muted-foreground">{t("rates_answeredBy")}</dt>
                        <dd>{status.answeredBy?.length ? status.answeredBy.map(nameOf).join(", ") : t("rates_never")}</dd>
                    </div>
                </dl>

                <ol className="space-y-3">
                    {form.providers.map((row, idx) => {
                        const about = entry(row.id);
                        if (!about) return null;
                        const keyField = about.keyField;
                        const keyStored = keyField !== null && keysStored.includes(keyField) && !form.clearKeys.includes(keyField);
                        // A source that is switched off is not asked, so its
                        // last error says nothing about now.
                        const lastError = row.enabled ? status.providers?.[row.id]?.lastError : null;
                        const overQuota = row.enabled && about.freeRequestsPerMonth !== null && callsPerMonth > about.freeRequestsPerMonth;
                        return (
                            <li key={row.id} className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <CheckboxField
                                        checked={row.enabled}
                                        onChange={(e) => setForm({
                                            ...form,
                                            providers: form.providers.map((one, i) => (i === idx ? { ...one, enabled: e.target.checked } : one)),
                                        })}
                                        label={<span className="font-medium">{about.name}</span>}
                                        description={t(`rates_about_${about.id.replace(/-/g, "_")}`)}
                                    />
                                    <div className="flex items-center gap-1">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            aria-label={t("rates_moveUp", { name: about.name })}
                                            disabled={idx === 0}
                                            onClick={() => move(idx, -1)}
                                        >
                                            <ChevronUp className="w-4 h-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            aria-label={t("rates_moveDown", { name: about.name })}
                                            disabled={idx === form.providers.length - 1}
                                            onClick={() => move(idx, 1)}
                                        >
                                            <ChevronDown className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <Badge tone={about.cadence === "daily" ? "neutral" : "info"}>{t(`rates_cadence_${about.cadence}`)}</Badge>
                                    <Badge>{keyField ? t("rates_needsKey") : t("rates_noKey")}</Badge>
                                    {about.covers && <Badge>{t("rates_covers", { codes: about.covers.join(", ") })}</Badge>}
                                    {about.approximate && <Badge tone="warning">{t("rates_approximate")}</Badge>}
                                    <span className="font-mono text-xs text-muted-foreground self-center">{about.host}</span>
                                </div>

                                {keyField && (
                                    <div>
                                        <Label htmlFor={`currency-rates-key-${row.id}`}>{t("rates_apiKey")}</Label>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                id={`currency-rates-key-${row.id}`}
                                                type="password"
                                                autoComplete="off"
                                                value={form.keys[keyField] ?? ""}
                                                onChange={(e) => setForm({ ...form, keys: { ...form.keys, [keyField]: e.target.value } })}
                                            />
                                            {keyStored && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    className="text-destructive"
                                                    onClick={async () => {
                                                        const ok = await confirm({
                                                            title: t("rates_removeKey"),
                                                            message: t("rates_removeKeyConfirm", { name: about.name }),
                                                            variant: "danger",
                                                        });
                                                        if (ok) setForm({ ...form, clearKeys: [...form.clearKeys, keyField] });
                                                    }}
                                                >
                                                    {t("rates_removeKey")}
                                                </Button>
                                            )}
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {keyStored ? t("rates_keyStored") : t("rates_keyNotSet")}
                                        </p>
                                    </div>
                                )}

                                {overQuota && (
                                    <p className="text-sm text-warning">
                                        {t("rates_quotaWarning", { count: callsPerMonth, limit: about.freeRequestsPerMonth ?? 0 })}
                                    </p>
                                )}
                                {lastError && (
                                    <p role="alert" className="text-sm text-destructive">
                                        {t("rates_lastError", { error: failureText(lastError) })}
                                    </p>
                                )}
                            </li>
                        );
                    })}
                </ol>
            </CardContent>
        </Card>
    );
}
