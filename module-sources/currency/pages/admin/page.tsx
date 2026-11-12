"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, useConfirm, CheckboxField } from "@/core/sdk/ui";
import { Loader2, Plus, Trash2, Save, Star } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader } from "@/core/sdk/admin";
import { errorMessage } from "@/core/sdk";
import { RateSources } from "./RateSources";

interface Currency {
    code: string;
    name: string;
    symbol: string;
    rate: number;
    enabled: boolean;
}

interface CurrencyConfig {
    base: string;
    currencies: Currency[];
    useFetchedRates: boolean;
}

/** As the endpoint answers: `rate` is what is shown, `manualRate` what was typed. */
interface ShownCurrency extends Currency {
    manualRate?: number;
    liveRate?: number | null;
}

/** Enough digits to compare with a typed rate, without a float's tail. */
const readable = (rate: number) => Number(rate.toPrecision(6)).toString();

export default function CurrencyAdminPage() {
    const t = useTranslations("currency");
    const commonT = useTranslations("common");
    const { confirm } = useConfirm();
    const [config, setConfig] = useState<CurrencyConfig>({ base: "USD", currencies: [], useFetchedRates: false });
    // The fetched rate per code, against the base as last saved. Read again
    // after a save, since changing the base changes every one of them.
    const [live, setLive] = useState<Record<string, number | null>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        const d = await (await fetch("/api/v1/currency")).json();
        const shown: ShownCurrency[] = Array.isArray(d.currencies) ? d.currencies : [];
        // The screen edits what was typed. `rate` in the answer is what the
        // footer shows, which is the fetched one while the switch is on.
        setConfig({
            base: d.base,
            useFetchedRates: d.useFetchedRates === true,
            currencies: shown.map((cur) => ({
                code: cur.code,
                name: cur.name,
                symbol: cur.symbol,
                enabled: cur.enabled,
                rate: cur.manualRate ?? cur.rate,
            })),
        });
        setLive(Object.fromEntries(shown.map((cur) => [cur.code, cur.liveRate ?? null])));
    }, []);

    useEffect(() => {
        load()
            .catch(() => toast.error(t("saveError")))
            .finally(() => setLoading(false));
    }, [load, t]);

    const updateCurrency = (idx: number, patch: Partial<Currency>) => {
        const next = [...config.currencies];
        next[idx] = { ...next[idx], ...patch };
        setConfig({ ...config, currencies: next });
    };

    const addCurrency = () => {
        setConfig({
            ...config,
            currencies: [
                ...config.currencies,
                { code: "", name: "", symbol: "", rate: 1, enabled: true },
            ],
        });
    };

    const removeCurrency = async (idx: number) => {
        const cur = config.currencies[idx];
        const ok = await confirm({
            title: t("removeCurrency"),
            message: `${cur.code || ""} ${cur.name || ""}`,
            variant: "danger",
        });
        if (!ok) return;
        const next = config.currencies.filter((_, i) => i !== idx);
        setConfig({ ...config, currencies: next });
    };

    const setBase = (code: string) => {
        if (!code) return;
        // The base is always enabled and always worth 1: it is the unit the
        // others are quoted in, and a disabled base would leave every price
        // measured against something the site does not offer.
        setConfig({
            ...config,
            base: code,
            currencies: config.currencies.map((c) =>
                c.code === code ? { ...c, rate: 1, enabled: true } : c,
            ),
        });
    };

    /** The first code that appears twice, or null. The server rejects these. */
    const duplicate = (() => {
        const seen = new Set<string>();
        for (const cur of config.currencies) {
            if (cur.code === "") continue;
            if (seen.has(cur.code)) return cur.code;
            seen.add(cur.code);
        }
        return null;
    })();

    const save = async () => {
        setSaving(true);
        try {
            const res = await fetch("/api/v1/currency", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(errorMessage(data, t("saveError"), t));
                return;
            }
            toast.success(t("saved"));
            await load();
        } catch {
            toast.error(t("saveError"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <>
            <AdminPageHeader
                title={t("settings")}
                description={t("adm_subtitle")}
                actions={
                    <Button onClick={save} disabled={saving || duplicate !== null}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {saving ? t("adm_saving") : commonT("save")}
                    </Button>
                }
            />

            {duplicate && (
                <Card className="mb-4 border-destructive">
                    <CardContent className="py-3 text-sm text-destructive">
                        {t("adm_duplicateCode", { code: duplicate })}
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>{t("exchangeRates")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <CheckboxField
                        checked={config.useFetchedRates}
                        onChange={(e) => setConfig({ ...config, useFetchedRates: e.target.checked })}
                        label={<span className="font-medium">{t("adm_useFetched")}</span>}
                        description={t("adm_useFetchedHint")}
                    />

                    {config.currencies.length === 0 && (
                        <p className="text-sm text-muted-foreground">{t("noCurrencies")}</p>
                    )}

                    {config.currencies.map((cur, idx) => {
                        const isBase = cur.code !== "" && cur.code === config.base;
                        const liveRate = live[cur.code] ?? null;
                        // A currency with a fetched rate is shown at it, so the
                        // typed one is kept but not offered. One without keeps
                        // its typed rate and says so.
                        const followsLive = config.useFetchedRates && liveRate !== null;
                        const missingLive = config.useFetchedRates && liveRate === null && !isBase;
                        return (
                            <div key={idx} className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="font-mono text-sm font-semibold">
                                            {cur.code || t("adm_untitled")}
                                        </span>
                                        {isBase && <Badge tone="info"><Star className="w-3 h-3" />{t("adm_isBase")}</Badge>}
                                        {!cur.enabled && <Badge>{t("disabled")}</Badge>}
                                        {missingLive && <Badge tone="warning">{t("adm_manualFallback")}</Badge>}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {!isBase && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                disabled={cur.code === ""}
                                                title={cur.code === "" ? t("adm_codeNeeded") : t("baseCurrency")}
                                                onClick={() => setBase(cur.code)}
                                            >
                                                <Star className="w-3.5 h-3.5" />
                                                {t("adm_makeBase")}
                                            </Button>
                                        )}
                                        <Button
                                            aria-label={commonT("delete")}
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            className="text-destructive"
                                            onClick={() => removeCurrency(idx)}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                    <div>
                                        <Label htmlFor={`currency-code-${idx}`}>{t("currencyCode")}</Label>
                                        <Input
                                            id={`currency-code-${idx}`}
                                            value={cur.code}
                                            onChange={(e) => updateCurrency(idx, { code: e.target.value.toUpperCase() })}
                                            placeholder="USD"
                                            className="font-mono"
                                        />
                                    </div>
                                    <div>
                                        <Label htmlFor={`currency-name-${idx}`}>{t("currencyName")}</Label>
                                        <Input
                                            id={`currency-name-${idx}`}
                                            value={cur.name}
                                            onChange={(e) => updateCurrency(idx, { name: e.target.value })}
                                            placeholder={t("adm_namePlaceholder")}
                                        />
                                    </div>
                                    <div>
                                        <Label htmlFor={`currency-symbol-${idx}`}>{t("symbol")}</Label>
                                        <Input
                                            id={`currency-symbol-${idx}`}
                                            value={cur.symbol}
                                            onChange={(e) => updateCurrency(idx, { symbol: e.target.value })}
                                            placeholder="$"
                                        />
                                    </div>
                                    <div>
                                        <Label htmlFor={`currency-rate-${idx}`}>{t("exchangeRate")}</Label>
                                        <Input
                                            id={`currency-rate-${idx}`}
                                            type="number"
                                            step="0.0001"
                                            min="0"
                                            // The base is what everything else is measured against,
                                            // so its own rate is 1 by definition. Letting it be
                                            // edited is letting the ruler be a different length.
                                            value={isBase ? 1 : cur.rate}
                                            disabled={isBase || followsLive}
                                            onChange={(e) => updateCurrency(idx, { rate: Number(e.target.value) || 0 })}
                                        />
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {isBase ? t("adm_baseRateHint") : t("adm_rateHint", { base: config.base })}
                                        </p>
                                        {!isBase && cur.code !== "" && (
                                            <p className={missingLive ? "mt-1 text-xs text-warning" : "mt-1 text-xs text-muted-foreground"}>
                                                {liveRate !== null
                                                    ? t("adm_liveRate", { rate: readable(liveRate) })
                                                    : t("adm_noLiveRate")}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <CheckboxField
                                    checked={cur.enabled}
                                    onChange={(e) => updateCurrency(idx, { enabled: e.target.checked })}
                                    label={t("enabled")}
                                    disabled={isBase}
                                    description={isBase ? t("adm_baseRateHint") : undefined}
                                />
                            </div>
                        );
                    })}

                    <Button type="button" variant="outline" onClick={addCurrency}>
                        <Plus className="w-4 h-4" />
                        {t("addCurrency")}
                    </Button>
                </CardContent>
            </Card>

            <RateSources />
        </>
    );
}
