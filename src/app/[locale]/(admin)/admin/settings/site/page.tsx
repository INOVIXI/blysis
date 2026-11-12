"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { Label } from "@/core/components/ui/label";
import { Textarea } from "@/core/components/ui/textarea";
import { NativeSelect } from "@/core/components/ui/native-select";
import { Loader2, Check } from "lucide-react";
import { AdminPageHeader } from "@/core/components/admin/AdminPageHeader";
import { LoadFailed } from "@/core/components/ui/load-failed";
import { useSettingsLoad } from "@/core/hooks/useSettingsLoad";
import { UrlOrFile } from "@/core/components/ui/url-or-file";
import { SITE_LOGO_KEY } from "@/core/lib/site-logo";
import { SITE_SOCIAL_LINKS, siteFormFromSettings, siteSettingsPatch, type SiteForm } from "@/core/lib/site-contact";

/**
 * Every zone this runtime knows, so an operator picks rather than types.
 *
 * `supportedValuesOf` is the list the platform itself uses; the fallback is
 * for a runtime that does not carry it, where a short list beats an empty
 * dropdown.
 */
const zones: string[] = (() => {
    try {
        return (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf("timeZone");
    } catch {
        return ["UTC", "Europe/Istanbul", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Tokyo"];
    }
})();

/** The header's submit button points at the form by id; they are the same form. */
const FORM_ID = "site-settings-form";

export default function SiteSettingsPage() {
    const t = useTranslations("admin");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Keyed by the settings the site reads (`site-contact.ts`). The screen
    // wrote keys of its own that nothing read, so a save renamed nothing.
    const [form, setForm] = useState<SiteForm>(() => ({ ...siteFormFromSettings({}), [SITE_LOGO_KEY]: "" }));
    // What was loaded, so a save can empty an older key it carried forward.
    const loaded = useRef<Record<string, unknown>>({});
    const field = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setForm({ ...form, [key]: e.target.value });

    // A read that failed would otherwise offer this form at its defaults, and
    // saving it would empty the site's name and every social link.
    const { loading, failed, retry } = useSettingsLoad((s) => {
        loaded.current = s;
        setForm({ ...siteFormFromSettings(s), [SITE_LOGO_KEY]: (s[SITE_LOGO_KEY] as string) || "" });
    });

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        setSaved(false);

        try {
            const res = await fetch("/api/v1/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...siteSettingsPatch(form, loaded.current),
                    [SITE_LOGO_KEY]: form[SITE_LOGO_KEY],
                }),
            });

            if (!res.ok) {
                setError(t("siteSettings_saveFailed"));
                return;
            }

            // An older key emptied by this save holds nothing now.
            loaded.current = {};
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch {
            setError(t("siteSettings_saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (failed) {
        return (
            <>
                <AdminPageHeader title={t("siteSettings_title")} description={t("siteSettings_subtitle")} />
                <Card><CardContent><LoadFailed onRetry={retry} /></CardContent></Card>
            </>
        );
    }

    return (
        <>
            {/* The page is one form, so its save is a page action: it sits in
                the header with everything else a screen offers, not under
                whichever card happens to be last. */}
            <AdminPageHeader
                title={t("siteSettings_title")}
                description={t("siteSettings_subtitle")}
                actions={
                    <Button type="submit" form={FORM_ID} disabled={saving}>
                        {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("siteSettings_saving")}</> :
                         saved ? <><Check className="w-4 h-4" /> {t("siteSettings_saved")}</> : t("siteSettings_saveSettings")}
                    </Button>
                }
            />

            {error && (
                <div role="alert" className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg">{error}</div>
            )}

            <form id={FORM_ID} onSubmit={handleSave}>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("siteSettings_general")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label>{t("siteSettings_siteName")}</Label>
                                <Input
                                    aria-label={t("siteSettings_siteName")}
                                    value={form.site_name}
                                    onChange={field("site_name")}
                                />
                            </div>
                            <div>
                                {/* The mark that goes with the name. Unset,
                                    the admin rail draws the name's initials,
                                    which is what it did before there was a
                                    logo to draw at all. */}
                                <UrlOrFile
                                    label={t("siteSettings_logo")}
                                    value={form[SITE_LOGO_KEY]}
                                    onChange={(v) => setForm({ ...form, [SITE_LOGO_KEY]: v })}
                                    accept="image/*"
                                />
                            </div>
                            <div>
                                <Label>{t("siteSettings_description")}</Label>
                                <Textarea
                                    aria-label={t("siteSettings_description")}
                                    value={form.site_description}
                                    onChange={field("site_description")}
                                    rows={3}
                                />
                            </div>
                            <div>
                                <Label htmlFor="site-timezone">{t("siteSettings_timezone")}</Label>
                                <NativeSelect
                                    id="site-timezone"
                                    className="mt-1"
                                    value={form.site_timezone}
                                    onChange={field("site_timezone")}
                                >
                                    {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                                </NativeSelect>
                                <p className="mt-1 text-sm text-muted-foreground">{t("siteSettings_timezoneHint")}</p>
                            </div>
                            <div>
                                <Label>{t("siteSettings_contactEmail")}</Label>
                                <Input
                                    aria-label={t("siteSettings_contactEmail")}
                                    type="email"
                                    value={form.site_email}
                                    onChange={field("site_email")}
                                    placeholder="support@example.com"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>{t("siteSettings_socialLinks")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {SITE_SOCIAL_LINKS.map((link) => (
                                <div key={link.key}>
                                    <Label htmlFor={link.key}>{link.label}</Label>
                                    <Input
                                        id={link.key}
                                        value={form[link.key] ?? ""}
                                        onChange={field(link.key)}
                                        placeholder={link.placeholder}
                                    />
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </div>

            </form>
        </>
    );
}
