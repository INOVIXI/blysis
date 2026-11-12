"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CheckboxField,
    Input,
    Label,
    LoadFailed,
    NativeSelect,
    Waiting,
} from "@/core/sdk/ui";
import { AdminPageHeader, RowActions } from "@/core/sdk/admin";
import { writeError } from "@/core/sdk";
import { EU_STANDARD_RATES, LABEL_PRESETS, type TaxConfig } from "../../lib/rules";

/**
 * How this shop charges tax.
 *
 * Its own screen rather than the generic module settings form, for two
 * reasons: the country table is a map the generic form has no shape for, and
 * that form speaks only English.
 */

/** The screen's word for each known name; the store translates the same ones on the order. */
const PRESET_KEYS: Record<(typeof LABEL_PRESETS)[number], string> = {
    tax: "label_tax",
    vat: "label_vat",
    gst: "label_gst",
    sales_tax: "label_salesTax",
};

/** Every region code the browser can name, so the list needs no table of our own. */
function regionCodes(): string[] {
    const codes: string[] = [];
    for (let a = 65; a <= 90; a++) {
        for (let b = 65; b <= 90; b++) codes.push(String.fromCharCode(a, b));
    }
    return codes;
}

export default function TaxSettingsPage() {
    const t = useTranslations("tax");
    const locale = useLocale();
    const [config, setConfig] = useState<TaxConfig | null>(null);
    const [failed, setFailed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [newCountry, setNewCountry] = useState("");
    const [newRate, setNewRate] = useState("");

    // The browser names a country in the reader's own language. A code it
    // cannot name is not a country (`AA`, `ZZ`), and is left out.
    const countries = useMemo(() => {
        let names: Intl.DisplayNames | null = null;
        try {
            names = new Intl.DisplayNames([locale], { type: "region", fallback: "none" });
        } catch {
            return [];
        }
        const display = names;
        return regionCodes()
            .map((code) => ({ code, name: display.of(code) }))
            .filter((entry): entry is { code: string; name: string } => typeof entry.name === "string" && entry.name !== "")
            .sort((a, b) => a.name.localeCompare(b.name, locale));
    }, [locale]);
    const nameOf = (code: string) => countries.find((entry) => entry.code === code)?.name ?? code;

    const load = useCallback(async () => {
        setFailed(false);
        try {
            const res = await fetch("/api/v1/tax/settings");
            if (!res.ok) throw new Error(String(res.status));
            setConfig((await res.json()) as TaxConfig);
        } catch {
            setFailed(true);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const set = (change: Partial<TaxConfig>) => setConfig((current) => (current ? { ...current, ...change } : current));

    const save = async () => {
        if (!config) return;
        setSaving(true);
        try {
            const res = await fetch("/api/v1/tax/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            });
            const error = await writeError(res, t("saveFailed"), t);
            if (error) {
                toast.error(error);
                return;
            }
            toast.success(t("saved"));
            await load();
        } finally {
            setSaving(false);
        }
    };

    const addRate = () => {
        const rate = Number(newRate);
        if (!config || newCountry === "" || !Number.isFinite(rate) || rate < 0 || rate > 100) return;
        set({ countryRates: { ...config.countryRates, [newCountry]: rate } });
        setNewCountry("");
        setNewRate("");
    };

    const removeRate = (code: string) => {
        if (!config) return;
        const rest = { ...config.countryRates };
        delete rest[code];
        set({ countryRates: rest });
    };

    // Added to what is there rather than replacing it, so a rate the operator
    // already corrected is not put back.
    const fillEu = () => {
        if (!config) return;
        set({ countryRates: { ...EU_STANDARD_RATES, ...config.countryRates } });
        toast.info(t("euFilled"));
    };

    if (failed) {
        return (
            <div className="space-y-6">
                <AdminPageHeader title={t("title")} description={t("subtitle")} />
                <Card>
                    <CardContent>
                        <LoadFailed onRetry={load} />
                    </CardContent>
                </Card>
            </div>
        );
    }
    if (!config) {
        return (
            <div className="space-y-6">
                <AdminPageHeader title={t("title")} description={t("subtitle")} />
                <Waiting label={t("loading")} />
            </div>
        );
    }

    const rows = Object.entries(config.countryRates).sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b), locale));

    return (
        <div className="space-y-6">
            <AdminPageHeader
                title={t("title")}
                description={t("subtitle")}
                actions={
                    <Button onClick={save} disabled={saving}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                        {t("save")}
                    </Button>
                }
            />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t("section_basics")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <CheckboxField
                        label={t("pricesIncludeTax")}
                        description={t("pricesIncludeTaxHelp")}
                        checked={config.pricesIncludeTax}
                        onChange={(e) => set({ pricesIncludeTax: e.target.checked })}
                    />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="space-y-1">
                            <Label htmlFor="tax-default-rate">{t("defaultRate")}</Label>
                            <Input
                                id="tax-default-rate"
                                type="number"
                                min={0}
                                max={100}
                                step={0.01}
                                value={String(config.defaultRate)}
                                onChange={(e) => set({ defaultRate: Number(e.target.value) || 0 })}
                            />
                            <p className="text-xs text-muted-foreground">{t("defaultRateHelp")}</p>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="tax-label">{t("label")}</Label>
                            <NativeSelect
                                id="tax-label"
                                className="w-full"
                                value={config.labelPreset}
                                onChange={(e) => set({ labelPreset: e.target.value as TaxConfig["labelPreset"] })}
                            >
                                {LABEL_PRESETS.map((preset) => (
                                    <option key={preset} value={preset}>
                                        {t(PRESET_KEYS[preset])}
                                    </option>
                                ))}
                                <option value="custom">{t("label_custom")}</option>
                            </NativeSelect>
                            <p className="text-xs text-muted-foreground">{t("labelHelp")}</p>
                        </div>
                        {config.labelPreset === "custom" && (
                            <div className="space-y-1">
                                <Label htmlFor="tax-label-text">{t("labelText")}</Label>
                                <Input
                                    id="tax-label-text"
                                    maxLength={40}
                                    value={config.labelText}
                                    onChange={(e) => set({ labelText: e.target.value })}
                                />
                                <p className="text-xs text-muted-foreground">{t("labelTextHelp")}</p>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t("section_countries")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                            <Label htmlFor="tax-seller-country">{t("sellerCountry")}</Label>
                            <NativeSelect
                                id="tax-seller-country"
                                className="w-full"
                                value={config.sellerCountry}
                                onChange={(e) => set({ sellerCountry: e.target.value })}
                            >
                                <option value="">{t("sellerCountryUnset")}</option>
                                {countries.map((entry) => (
                                    <option key={entry.code} value={entry.code}>
                                        {entry.name}
                                    </option>
                                ))}
                            </NativeSelect>
                            <p className="text-xs text-muted-foreground">{t("sellerCountryHelp")}</p>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="tax-outside">{t("outsideArea")}</Label>
                            <NativeSelect
                                id="tax-outside"
                                className="w-full"
                                value={config.outsideArea}
                                onChange={(e) => set({ outsideArea: e.target.value === "zero" ? "zero" : "default" })}
                            >
                                <option value="default">{t("outsideArea_default")}</option>
                                <option value="zero">{t("outsideArea_zero")}</option>
                            </NativeSelect>
                            <p className="text-xs text-muted-foreground">{t("outsideAreaHelp")}</p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium">{t("countryRates")}</p>
                            <Button variant="outline" size="sm" onClick={fillEu}>
                                {t("fillEu")}
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">{t("countryRatesHelp")}</p>
                        {rows.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t("noCountryRates")}</p>
                        ) : (
                            <ul className="divide-y divide-border rounded-md border border-border">
                                {rows.map(([code, rate]) => (
                                    <li key={code} className="flex items-center gap-3 px-3 py-2 text-sm">
                                        <span className="flex-1">
                                            {nameOf(code)} <span className="text-muted-foreground">({code})</span>
                                        </span>
                                        <Input
                                            aria-label={t("rateFor", { country: nameOf(code) })}
                                            className="w-24"
                                            type="number"
                                            min={0}
                                            max={100}
                                            step={0.01}
                                            value={String(rate)}
                                            onChange={(e) =>
                                                set({ countryRates: { ...config.countryRates, [code]: Number(e.target.value) || 0 } })
                                            }
                                        />
                                        <span className="text-muted-foreground">%</span>
                                        <RowActions
                                            actions={[
                                                {
                                                    icon: Trash2,
                                                    label: t("removeRate", { country: nameOf(code) }),
                                                    onClick: () => removeRate(code),
                                                    destructive: true,
                                                },
                                            ]}
                                        />
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="flex flex-wrap items-end gap-2">
                            <div className="min-w-48 flex-1 space-y-1">
                                <Label htmlFor="tax-new-country">{t("country")}</Label>
                                <NativeSelect
                                    id="tax-new-country"
                                    className="w-full"
                                    value={newCountry}
                                    onChange={(e) => setNewCountry(e.target.value)}
                                >
                                    <option value="">{t("pickCountry")}</option>
                                    {countries.map((entry) => (
                                        <option key={entry.code} value={entry.code}>
                                            {entry.name}
                                        </option>
                                    ))}
                                </NativeSelect>
                            </div>
                            <div className="w-28 space-y-1">
                                <Label htmlFor="tax-new-rate">{t("rate")}</Label>
                                <Input
                                    id="tax-new-rate"
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={0.01}
                                    value={newRate}
                                    onChange={(e) => setNewRate(e.target.value)}
                                />
                            </div>
                            <Button variant="outline" onClick={addRate} disabled={newCountry === "" || newRate === ""}>
                                <Plus className="h-4 w-4" aria-hidden="true" />
                                {t("addRate")}
                            </Button>
                        </div>
                    </div>

                    <CheckboxField
                        label={t("reverseCharge")}
                        description={t("reverseChargeHelp")}
                        checked={config.reverseCharge}
                        onChange={(e) => set({ reverseCharge: e.target.checked })}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t("section_evidence")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <CheckboxField
                        label={t("requireBillingAddress")}
                        description={t("requireBillingAddressHelp")}
                        checked={config.requireBillingAddress}
                        onChange={(e) => set({ requireBillingAddress: e.target.checked })}
                    />
                    <CheckboxField
                        label={t("trustCountryHeader")}
                        description={t("trustCountryHeaderHelp")}
                        checked={config.trustCountryHeader}
                        onChange={(e) => set({ trustCountryHeader: e.target.checked })}
                    />
                    {config.trustCountryHeader && (
                        <div className="space-y-1">
                            <Label htmlFor="tax-country-header">{t("countryHeader")}</Label>
                            <Input
                                id="tax-country-header"
                                maxLength={64}
                                value={config.countryHeader}
                                onChange={(e) => set({ countryHeader: e.target.value })}
                            />
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground">{t("evidenceHelp")}</p>
                </CardContent>
            </Card>

        </div>
    );
}
