"use client";


import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Textarea, UrlOrFile} from "@/core/sdk/ui";
import { Loader2, Check, FileText, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@/core/sdk/navigation";
import { AdminPageHeader } from "@/core/sdk/admin";
import { errorMessage } from "@/core/sdk";

interface SeoSettings {
    seo_title_template: string;
    seo_keywords: string;
    seo_default_og_image: string;
    seo_google_verification: string;
    seo_bing_verification: string;
}

const DEFAULT_SETTINGS: SeoSettings = {
    seo_title_template: "",
    seo_keywords: "",
    seo_default_og_image: "",
    seo_google_verification: "",
    seo_bing_verification: "",
};

/** The header's submit button points at the form by id; they are the same form. */
const FORM_ID = "seo-settings-form";

export default function SeoSettingsPage() {
    const t = useTranslations("seo");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [settings, setSettings] = useState<SeoSettings>(DEFAULT_SETTINGS);

    useEffect(() => {
        fetch("/api/v1/seo/settings")
            .then((r) => r.json())
            .then((data) => {
                const s = data.settings || {};
                setSettings({
                    seo_title_template: (s.seo_title_template as string) || "",
                    seo_keywords: (s.seo_keywords as string) || "",
                    seo_default_og_image: (s.seo_default_og_image as string) || "",
                    seo_google_verification: (s.seo_google_verification as string) || "",
                    seo_bing_verification: (s.seo_bing_verification as string) || "",
                });
            })
            .catch(() => toast.error(t("adm_settingsLoadFailed")))
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setSaved(false);

        try {
            const res = await fetch("/api/v1/seo/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(settings),
            });

            if (!res.ok) {
                const data = await res.json();
                toast.error(errorMessage(data, t("adm_settingsSaveFailed"), t));
                return;
            }

            setSaved(true);
            toast.success(t("adm_settingsSaved"));
            setTimeout(() => setSaved(false), 3000);
        } catch {
            toast.error(t("adm_genericError"));
        } finally {
            setSaving(false);
        }
    };

    const updateSetting = (key: keyof SeoSettings, value: string) => {
        setSettings((prev) => ({ ...prev, [key]: value }));
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <>
            {/* No wrapper: the header lays out its own row, and the extra
                flex box around it only added a second set of margins. The
                action slot holds the screen's save, not a decorative tile -
                an icon in a header is something to press everywhere else. */}
            <AdminPageHeader
                title={t("adm_seoManager")}
                description={t("adm_seoManagerSubtitle")}
                actions={
                    <Button type="submit" form={FORM_ID} disabled={saving}>
                        {saving ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> {t("adm_saving")}</>
                        ) : saved ? (
                            <><Check className="w-4 h-4" /> {t("adm_saved")}</>
                        ) : (
                            t("adm_saveSettings")
                        )}
                    </Button>
                }
            />

            {/* Page SEO Overrides Link */}
            <Link href="/admin/seo/pages">
                <Card className="mb-6 cursor-pointer hover:border-primary/50 transition-colors">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <FileText className="w-5 h-5 text-muted-foreground" />
                            <div>
                                <p className="font-medium text-foreground">{t("adm_pageSeoOverrides")}</p>
                                <p className="text-sm text-muted-foreground">{t("adm_pageSeoOverridesDesc")}</p>
                            </div>
                        </div>
                        <ArrowRight className="w-5 h-5 text-muted-foreground" />
                    </CardContent>
                </Card>
            </Link>

            {/* Global SEO Settings */}
            <form id={FORM_ID} onSubmit={handleSave}>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-foreground">{t("adm_globalSeoSettings")}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <p className="text-sm text-muted-foreground">{t("adm_siteWordsLiveElsewhere")}</p>

                        <div>
                            <Label className="text-foreground">{t("adm_titleTemplate")}</Label>
                            <Input
                                aria-label={t("adm_titleTemplate")}
                                value={settings.seo_title_template}
                                onChange={(e) => updateSetting("seo_title_template", e.target.value)}
                                placeholder={t("adm_titleTemplateExample")}
                            />
                            <p className="text-xs text-muted-foreground mt-1">{t("adm_titleTemplateHint")}</p>
                        </div>

                        <div>
                            <Label className="text-foreground">{t("adm_keywords")}</Label>
                            <Textarea
                                aria-label={t("adm_keywords")}
                                value={settings.seo_keywords}
                                onChange={(e) => updateSetting("seo_keywords", e.target.value)}
                                placeholder="keyword1, keyword2, keyword3"
                                rows={2}
                            />
                            <p className="text-xs text-muted-foreground mt-1">{t("adm_siteKeywordsHelp")}</p>
                        </div>

                        <div>
                            <UrlOrFile
                                label={t("adm_defaultOgImage")}
                                value={settings.seo_default_og_image}
                                onChange={(v) => updateSetting("seo_default_og_image", v)}
                                accept="image/*"
                                placeholder="https://example.com/og-image.png"
                            />
                            <p className="text-xs text-muted-foreground mt-1">{t("adm_defaultOgImageHelp")}</p>
                        </div>

                        <div className="border-t border-border pt-5">
                            <h2 className="text-sm font-semibold text-foreground mb-4">{t("adm_searchEngineVerification")}</h2>
                            <div className="space-y-4">
                                <div>
                                    <Label className="text-foreground">{t("adm_googleVerification")}</Label>
                                    <Input
                                        aria-label={t("adm_googleVerification")}
                                        value={settings.seo_google_verification}
                                        onChange={(e) => updateSetting("seo_google_verification", e.target.value)}
                                        placeholder="abcd1234efgh5678"
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">{t("adm_googleVerificationHelp")}</p>
                                </div>
                                <div>
                                    <Label className="text-foreground">{t("adm_bingVerification")}</Label>
                                    <Input
                                        aria-label={t("adm_bingVerification")}
                                        value={settings.seo_bing_verification}
                                        onChange={(e) => updateSetting("seo_bing_verification", e.target.value)}
                                        placeholder="ABCD1234EFGH5678"
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">{t("adm_bingVerificationHelp")}</p>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

            </form>
        </>
    );
}
