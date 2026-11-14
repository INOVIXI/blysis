"use client";

/**
 * Everything the AI reviewer does is set here: what it reads, what it is told,
 * how sure it must be, and how much it takes on. Nothing is fixed in code; the
 * defaults in `lib/config.ts` lean towards a person, and an empty list of
 * kinds or reasons it may reject with means it rejects nothing.
 *
 * Which kinds are reviewed at all is the moderation settings screen's choice
 * ("review"), and the daily token cap is the AI screen's; both are linked.
 */
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { Link } from "@/core/sdk/navigation";
import { Button, Card, CardContent, CardHeader, CardTitle, CheckboxField, Input, Label, LoadFailed, Textarea } from "@/core/sdk/ui";
import { AdminPageHeader, useSettingsLoad } from "@/core/sdk/admin";
import { writeError } from "@/core/sdk";
import { NUMBER_BOUNDS, SETTING_KEYS, TEXT_MAX, configFrom, type AiModerationConfig } from "../../../lib/config";

interface Choice {
    id: string;
    label: string;
    labelKey?: string;
}

type NumberField = keyof typeof NUMBER_BOUNDS;

function toggled(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export default function AiModerationSettingsPage() {
    const t = useTranslations("aiModeration");
    const tAdmin = useTranslations("admin");
    const locale = useLocale();
    const [config, setConfig] = useState<AiModerationConfig>(() => configFrom({}));
    const [kinds, setKinds] = useState<Choice[]>([]);
    const [reasons, setReasons] = useState<Choice[]>([]);
    const [saving, setSaving] = useState(false);
    const { loading, failed, retry } = useSettingsLoad((settings) => setConfig(configFrom(settings)));

    useEffect(() => {
        // A language switched while this was in flight must not be overwritten
        // by the answer in the language it left.
        let cancelled = false;
        fetch(`/api/v1/ai-moderation/admin/options?locale=${encodeURIComponent(locale)}`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
            .then((data) => {
                if (cancelled) return;
                setKinds(data?.kinds ?? []);
                setReasons(data?.reasons ?? []);
            })
            .catch(() => {
                if (!cancelled) toast.error(t("settings_optionsFailed"));
            });
        return () => { cancelled = true; };
    }, [locale, t]);

    const kindName = (kind: Choice) => (kind.labelKey && tAdmin.has(kind.labelKey) ? tAdmin(kind.labelKey) : kind.label);
    const set = <K extends keyof AiModerationConfig>(key: K, value: AiModerationConfig[K]) => setConfig((prev) => ({ ...prev, [key]: value }));

    const save = async () => {
        setSaving(true);
        try {
            const res = await fetch("/api/v1/settings", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    [SETTING_KEYS.rules]: config.rules,
                    [SETTING_KEYS.instructions]: config.instructions,
                    [SETTING_KEYS.model]: config.model,
                    [SETTING_KEYS.approveAt]: config.approveAt,
                    [SETTING_KEYS.rejectAt]: config.rejectAt,
                    [SETTING_KEYS.kinds]: config.kinds,
                    [SETTING_KEYS.rejectKinds]: config.rejectKinds,
                    [SETTING_KEYS.reasons]: config.reasons,
                    [SETTING_KEYS.batchSize]: config.batchSize,
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
        const id = `ai-moderation-${key}`;
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
                <CardHeader><CardTitle className="text-base">{t("settings_whatTitle")}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        {t("settings_whatHint")}{" "}
                        <Link href="/admin/settings/moderation" className="text-primary hover:underline">{t("settings_openModeration")}</Link>
                    </p>
                    {kinds.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("settings_noKinds")}</p>
                    ) : (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {kinds.map((kind) => (
                                <CheckboxField
                                    key={kind.id}
                                    label={kindName(kind)}
                                    checked={config.kinds.includes(kind.id)}
                                    onChange={() => set("kinds", toggled(config.kinds, kind.id))}
                                />
                            ))}
                        </div>
                    )}
                    {config.kinds.length === 0 && kinds.length > 0 && <p className="text-xs text-muted-foreground">{t("settings_allKinds")}</p>}
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle className="text-base">{t("settings_toldTitle")}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="ai-moderation-rules">{t("settings_rules")}</Label>
                        <Textarea
                            id="ai-moderation-rules"
                            rows={6}
                            maxLength={TEXT_MAX.rules}
                            value={config.rules}
                            onChange={(e) => set("rules", e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">{t("settings_rulesHint")}</p>
                    </div>
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <Label htmlFor="ai-moderation-instructions">{t("settings_instructions")}</Label>
                            <Button variant="ghost" size="sm" onClick={() => set("instructions", "")} disabled={!config.instructions}>
                                <RotateCcw className="w-4 h-4" aria-hidden="true" /> {t("settings_instructionsReset")}
                            </Button>
                        </div>
                        <Textarea
                            id="ai-moderation-instructions"
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
                        <Label htmlFor="ai-moderation-model">{t("settings_model")}</Label>
                        <Input
                            id="ai-moderation-model"
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
                <CardHeader><CardTitle className="text-base">{t("settings_decideTitle")}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {number("approveAt", t("settings_approveAt"), t("settings_approveAtHint"))}
                        {number("rejectAt", t("settings_rejectAt"), t("settings_rejectAtHint"))}
                    </div>
                    <div className="space-y-2">
                        <p className="text-sm font-medium">{t("settings_rejectKinds")}</p>
                        <p className="text-xs text-muted-foreground">{t("settings_rejectKindsHint")}</p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {kinds.map((kind) => (
                                <CheckboxField
                                    key={kind.id}
                                    label={kindName(kind)}
                                    checked={config.rejectKinds.includes(kind.id)}
                                    onChange={() => set("rejectKinds", toggled(config.rejectKinds, kind.id))}
                                />
                            ))}
                        </div>
                    </div>
                    <div className="space-y-2">
                        <p className="text-sm font-medium">{t("settings_reasons")}</p>
                        <p className="text-xs text-muted-foreground">
                            {t("settings_reasonsHint")}{" "}
                            <Link href="/admin/settings/moderation/reasons" className="text-primary hover:underline">{t("settings_editReasons")}</Link>
                        </p>
                        {reasons.length === 0 ? (
                            <p className="text-sm text-muted-foreground">{t("settings_noReasons")}</p>
                        ) : (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {reasons.map((reason) => (
                                    <CheckboxField
                                        key={reason.id}
                                        label={reason.label}
                                        checked={config.reasons.includes(reason.id)}
                                        onChange={() => set("reasons", toggled(config.reasons, reason.id))}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle className="text-base">{t("settings_paceTitle")}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {number("perRun", t("settings_perRun"), t("settings_perRunHint"))}
                        {number("batchSize", t("settings_batchSize"), t("settings_batchSizeHint"))}
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
