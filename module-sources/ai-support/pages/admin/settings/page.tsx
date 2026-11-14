"use client";

/**
 * Everything the support assistant does is set here: which departments it
 * answers and how, when it may answer on its own, what it is told and what it
 * may draw on. Nothing is fixed in code; the defaults in `lib/config.ts` lean
 * towards a person, and a department nobody set is off.
 *
 * The daily token cap is the AI screen's, and the sources come from whatever
 * modules offer one; both are linked or listed here.
 */
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, CheckboxField, Input, Label, LoadFailed, NativeSelect, Textarea } from "@/core/sdk/ui";
import { AdminPageHeader, useSettingsLoad } from "@/core/sdk/admin";
import { writeError } from "@/core/sdk";
import {
    ALL_DAYS,
    CLASSIFY,
    MODES,
    NUMBER_BOUNDS,
    REPLY_LANGUAGES,
    SETTING_KEYS,
    TEXT_MAX,
    configFrom,
    type AiSupportConfig,
    type Classify,
    type Mode,
    type ReplyLanguage,
} from "../../../lib/config";

interface Choice {
    id: string;
    label: string;
}

type NumberField = keyof typeof NUMBER_BOUNDS;

function toggled<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

/** 2026-11-15 is a Sunday: day `d` of the week is that date plus `d` days. */
function weekdayName(day: number, locale: string): string {
    return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 15 + day)));
}

export default function AiSupportSettingsPage() {
    const t = useTranslations("aiSupport");
    const locale = useLocale();
    const [config, setConfig] = useState<AiSupportConfig>(() => configFrom({}));
    const [departments, setDepartments] = useState<Choice[]>([]);
    const [sources, setSources] = useState<Choice[]>([]);
    const [saving, setSaving] = useState(false);
    const { loading, failed, retry } = useSettingsLoad((settings) => setConfig(configFrom(settings)));

    useEffect(() => {
        // A language switched while this was in flight must not be overwritten
        // by the answer in the language it left.
        let cancelled = false;
        fetch(`/api/v1/ai-support/admin/options?locale=${encodeURIComponent(locale)}`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((data) => {
                if (cancelled) return;
                setDepartments(data?.departments ?? []);
                setSources(data?.sources ?? []);
            })
            .catch(() => {
                if (!cancelled) toast.error(t("settings_optionsFailed"));
            });
        return () => { cancelled = true; };
    }, [locale, t]);

    const set = <K extends keyof AiSupportConfig>(key: K, value: AiSupportConfig[K]) => setConfig((prev) => ({ ...prev, [key]: value }));
    // Until the operator picks, every source is on; the list they see says so.
    const enabledSources = useMemo(() => config.sources ?? sources.map((s) => s.id), [config.sources, sources]);

    const save = async () => {
        setSaving(true);
        try {
            const res = await fetch("/api/v1/settings", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    [SETTING_KEYS.modes]: config.modes,
                    [SETTING_KEYS.waitMinutes]: config.waitMinutes,
                    [SETTING_KEYS.days]: config.days,
                    [SETTING_KEYS.from]: config.from,
                    [SETTING_KEYS.to]: config.to,
                    [SETTING_KEYS.maxAuto]: config.maxAuto,
                    [SETTING_KEYS.threshold]: config.threshold,
                    [SETTING_KEYS.classifyDepartment]: config.classifyDepartment,
                    [SETTING_KEYS.classifyPriority]: config.classifyPriority,
                    [SETTING_KEYS.tone]: config.tone,
                    [SETTING_KEYS.instructions]: config.instructions,
                    [SETTING_KEYS.replyLanguage]: config.replyLanguage,
                    [SETTING_KEYS.maxLength]: config.maxLength,
                    [SETTING_KEYS.sources]: config.sources,
                    [SETTING_KEYS.perSource]: config.perSource,
                    [SETTING_KEYS.siteInfo]: config.siteInfo,
                    [SETTING_KEYS.model]: config.model,
                    [SETTING_KEYS.perRun]: config.perRun,
                    [SETTING_KEYS.maxAttempts]: config.maxAttempts,
                    [SETTING_KEYS.retentionDays]: config.retentionDays,
                }),
            });
            if (!res.ok) {
                toast.error((await writeError(res, t("settings_saveFailed"), t)) ?? t("settings_saveFailed"));
                return;
            }
            toast.success(t("settings_saved"));
        } catch {
            toast.error(t("settings_saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const number = (key: NumberField, label: string, hint: string) => {
        const { min, max } = NUMBER_BOUNDS[key];
        const id = `ai-support-${key}`;
        return (
            <div className="space-y-1.5">
                <Label htmlFor={id}>{label}</Label>
                <Input
                    id={id}
                    type="number"
                    min={min}
                    max={max}
                    value={config[key]}
                    onChange={(e) => set(key, Math.min(max, Math.max(min, Math.round(Number(e.target.value) || min))))}
                />
                <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
        );
    };

    const header = (
        <AdminPageHeader
            title={t("settings_title")}
            description={t("settings_subtitle")}
            actions={
                <Button onClick={save} disabled={saving || loading || failed}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
                    {t("settings_save")}
                </Button>
            }
        />
    );

    if (loading) {
        return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
    }
    if (failed) {
        return <>{header}<Card><CardContent><LoadFailed onRetry={retry} /></CardContent></Card></>;
    }

    return (
        <div className="space-y-6">
            {header}

            <Card>
                <CardHeader><CardTitle className="text-base">{t("settings_departmentsTitle")}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">{t("settings_departmentsHint")}</p>
                    {departments.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("settings_noDepartments")}</p>
                    ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {departments.map((department) => (
                                <div key={department.id} className="space-y-1.5">
                                    <Label htmlFor={`ai-support-mode-${department.id}`}>{department.label}</Label>
                                    <NativeSelect
                                        id={`ai-support-mode-${department.id}`}
                                        className="w-full"
                                        value={config.modes[department.id] ?? "off"}
                                        onChange={(e) => {
                                            const mode = e.target.value as Mode;
                                            const next = { ...config.modes };
                                            if (mode === "off") delete next[department.id];
                                            else next[department.id] = mode;
                                            set("modes", next);
                                        }}
                                    >
                                        {MODES.map((mode) => <option key={mode} value={mode}>{t(`mode_${mode}`)}</option>)}
                                    </NativeSelect>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle className="text-base">{t("settings_autoTitle")}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">{t("settings_autoHint")}</p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        {number("waitMinutes", t("settings_waitMinutes"), t("settings_waitMinutesHint"))}
                        {number("threshold", t("settings_threshold"), t("settings_thresholdHint"))}
                        {number("maxAuto", t("settings_maxAuto"), t("settings_maxAutoHint"))}
                    </div>
                    <div className="space-y-2">
                        <p className="text-sm font-medium">{t("settings_days")}</p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                            {ALL_DAYS.map((day) => (
                                <CheckboxField
                                    key={day}
                                    label={weekdayName(day, locale)}
                                    checked={config.days.includes(day)}
                                    onChange={() => set("days", toggled(config.days, day).sort())}
                                />
                            ))}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="ai-support-from">{t("settings_from")}</Label>
                            <Input id="ai-support-from" type="time" value={config.from} onChange={(e) => set("from", e.target.value || "00:00")} />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="ai-support-to">{t("settings_to")}</Label>
                            <Input id="ai-support-to" type="time" value={config.to} onChange={(e) => set("to", e.target.value || "00:00")} />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{t("settings_hoursHint")}</p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle className="text-base">{t("settings_sortTitle")}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">{t("settings_sortHint")}</p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {(["classifyDepartment", "classifyPriority"] as const).map((key) => (
                            <div key={key} className="space-y-1.5">
                                <Label htmlFor={`ai-support-${key}`}>{t(key === "classifyDepartment" ? "settings_classifyDepartment" : "settings_classifyPriority")}</Label>
                                <NativeSelect
                                    id={`ai-support-${key}`}
                                    className="w-full"
                                    value={config[key]}
                                    onChange={(e) => set(key, e.target.value as Classify)}
                                >
                                    {CLASSIFY.map((value) => <option key={value} value={value}>{t(`classify_${value}`)}</option>)}
                                </NativeSelect>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle className="text-base">{t("settings_toldTitle")}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <Label htmlFor="ai-support-instructions">{t("settings_instructions")}</Label>
                            <Button variant="ghost" size="sm" onClick={() => set("instructions", "")} disabled={!config.instructions}>
                                <RotateCcw className="w-4 h-4" aria-hidden="true" /> {t("settings_instructionsReset")}
                            </Button>
                        </div>
                        <Textarea
                            id="ai-support-instructions"
                            rows={8}
                            maxLength={TEXT_MAX.instructions}
                            value={config.instructions || t("defaultInstructions")}
                            onChange={(e) => set("instructions", e.target.value === t("defaultInstructions") ? "" : e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            {config.instructions ? t("settings_instructionsOwn") : t("settings_instructionsDefault")}
                        </p>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="ai-support-tone">{t("settings_tone")}</Label>
                        <Input
                            id="ai-support-tone"
                            maxLength={TEXT_MAX.tone}
                            value={config.tone}
                            placeholder={t("settings_tonePlaceholder")}
                            onChange={(e) => set("tone", e.target.value)}
                        />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="ai-support-language">{t("settings_replyLanguage")}</Label>
                            <NativeSelect
                                id="ai-support-language"
                                className="w-full"
                                value={config.replyLanguage}
                                onChange={(e) => set("replyLanguage", e.target.value as ReplyLanguage)}
                            >
                                {REPLY_LANGUAGES.map((value) => <option key={value} value={value}>{t(`language_${value}`)}</option>)}
                            </NativeSelect>
                        </div>
                        {number("maxLength", t("settings_maxLength"), t("settings_maxLengthHint"))}
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="ai-support-model">{t("settings_model")}</Label>
                        <Input
                            id="ai-support-model"
                            maxLength={TEXT_MAX.model}
                            value={config.model}
                            placeholder={t("settings_modelPlaceholder")}
                            onChange={(e) => set("model", e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">{t("settings_modelHint")}</p>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle className="text-base">{t("settings_knowledgeTitle")}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="ai-support-site-info">{t("settings_siteInfo")}</Label>
                        <Textarea
                            id="ai-support-site-info"
                            rows={6}
                            maxLength={TEXT_MAX.siteInfo}
                            value={config.siteInfo}
                            onChange={(e) => set("siteInfo", e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">{t("settings_siteInfoHint")}</p>
                    </div>
                    <div className="space-y-2">
                        <p className="text-sm font-medium">{t("settings_sources")}</p>
                        {sources.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t("settings_noSources")}</p>
                        ) : (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {sources.map((source) => (
                                    <CheckboxField
                                        key={source.id}
                                        label={source.label}
                                        checked={enabledSources.includes(source.id)}
                                        onChange={() => set("sources", toggled(enabledSources, source.id))}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {number("perSource", t("settings_perSource"), t("settings_perSourceHint"))}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle className="text-base">{t("settings_paceTitle")}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        {number("perRun", t("settings_perRun"), t("settings_perRunHint"))}
                        {number("maxAttempts", t("settings_maxAttempts"), t("settings_maxAttemptsHint"))}
                        {number("retentionDays", t("settings_retentionDays"), t("settings_retentionDaysHint"))}
                    </div>
                    <p className="text-sm text-muted-foreground">
                        {t("settings_budgetHint")}{" "}
                        <Link href="/admin/settings/ai" className="text-primary hover:underline">{t("settings_openAi")}</Link>
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
