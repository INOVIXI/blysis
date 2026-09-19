"use client";

import { useEffect, useState } from "react";
import { Link } from "@/core/lib/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { badgeClassName } from "@/core/components/ui/badge";
import { Checkbox } from "@/core/components/ui/checkbox";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { errorMessage } from "@/core/lib/write-result";

type ModerationMode = "auto" | "manual";

interface ModerationField {
    settingKey: string;
    label: string;
    labelKey?: string;
    descKey?: string;
}

export default function ModerationSettingsPage() {
    const t = useTranslations("admin");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [fields, setFields] = useState<ModerationField[]>([]);
    const [config, setConfig] = useState<Record<string, ModerationMode>>({});
    // Both reads already returned null on a failure, and both nulls then
    // became `{}`: every type read as "auto" and saving wrote that over
    // whatever the site actually had. A failure is a failure now.
    const [loadFailed, setLoadFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadFailed(false);
        Promise.all([
            fetch("/api/v1/admin/moderation").then((r) => (r.ok ? r.json() : Promise.reject(new Error("moderation")))),
            fetch("/api/v1/settings").then((r) => (r.ok ? r.json() : Promise.reject(new Error("settings")))),
        ])
            .then(([modPayload, settingsPayload]) => {
                if (cancelled) return;
                const types = (modPayload?.types ?? {}) as Record<
                    string,
                    { label: string; settingKey?: string; settingLabelKey?: string; settingDescKey?: string }
                >;
                const builtFields: ModerationField[] = [];
                for (const meta of Object.values(types)) {
                    if (!meta.settingKey) continue;
                    builtFields.push({
                        settingKey: meta.settingKey,
                        label: meta.label,
                        labelKey: meta.settingLabelKey,
                        descKey: meta.settingDescKey,
                    });
                }
                setFields(builtFields);

                const stored = (settingsPayload?.settings?.moderation ?? {}) as Record<string, unknown>;
                const next: Record<string, ModerationMode> = {};
                for (const f of builtFields) {
                    next[f.settingKey] = stored[f.settingKey] === "manual" ? "manual" : "auto";
                }
                setConfig(next);
            })
            .catch(() => {
                if (cancelled) return;
                setLoadFailed(true);
                toast.error(t("moderationSettings_loadFailed"));
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [t, attempt]);

    const toggleField = (key: string) => {
        setConfig((prev) => ({
            ...prev,
            [key]: prev[key] === "manual" ? "auto" : "manual",
        }));
    };

    const onSave = async () => {
        setSaving(true);
        try {
            const res = await fetch("/api/v1/settings", {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ moderation: config }),
            });
            if (!res.ok) {
                const data = (await res.json().catch(() => null)) as { error?: string } | null;
                toast.error(errorMessage(data, t("moderationSettings_saveFailed"), t));
                return;
            }
            toast.success(t("moderationSettings_saved"));
        } catch {
            toast.error(t("moderationSettings_saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (loadFailed) {
        return (
            <div className="space-y-6">
                <AdminPageHeader
                    title={t("moderationSettings_title")}
                    description={t("moderationSettings_subtitle")}
                />
                <Card>
                    <CardContent><LoadFailed onRetry={() => setAttempt((a) => a + 1)} /></CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* The page is one form, so its save is a page action: it sits in
                the header rather than at the far end of the row that carries
                the link to the queue. */}
            <AdminPageHeader
                title={t("moderationSettings_title")}
                description={t("moderationSettings_subtitle")}
                actions={
                    <Button onClick={onSave} disabled={saving}>
                        {saving ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" /> {t("moderationSettings_saving")}
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" /> {t("moderationSettings_saveChanges")}
                            </>
                        )}
                    </Button>
                }
            />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">{t("moderationSettings_approvalRequired")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {fields.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            {t("moderationSettings_noProviders")}
                        </p>
                    ) : (
                        fields.map((field) => (
                            <label
                                key={field.settingKey}
                                className="flex items-start gap-3 cursor-pointer border border-border rounded-md p-3 hover:bg-muted"
                            >
                                <Checkbox
                                    checked={config[field.settingKey] === "manual"}
                                    onChange={() => toggleField(field.settingKey)}
                                    className="mt-0.5"
                                />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground">
                                        {field.labelKey && t.has(field.labelKey) ? t(field.labelKey) : field.label}
                                    </p>
                                    {field.descKey && t.has(field.descKey) && (
                                        <p className="text-xs text-muted-foreground">{t(field.descKey)}</p>
                                    )}
                                </div>
                                {/* The setting's own value used to be printed
                                    here, so the badge read AUTO and MANUAL -
                                    the two words the column stores, in the
                                    typeface of a machine, on a screen an
                                    operator reads. */}
                                <span
                                    className={badgeClassName(config[field.settingKey] === "manual" ? "warning" : "neutral")}
                                >
                                    {config[field.settingKey] === "manual"
                                        ? t("moderationSettings_manual")
                                        : t("moderationSettings_auto")}
                                </span>
                            </label>
                        ))
                    )}
                </CardContent>
            </Card>

            <div>
                <Link
                    href="/admin/moderation"
                    className="text-sm text-primary hover:underline"
                >
                    {t("moderationSettings_openQueue")}
                </Link>
            </div>
        </div>
    );
}
