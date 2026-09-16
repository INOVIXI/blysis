"use client";

import { useState } from "react";
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

    const [form, setForm] = useState({
        siteName: "",
        [SITE_LOGO_KEY]: "",
        siteDescription: "",
        serverIp: "",
        contactEmail: "",
        socialFacebook: "",
        socialInstagram: "",
        socialTwitter: "",
        socialYoutube: "",
        socialDiscord: "",
        timezone: "UTC",
    });

    // A read that failed would otherwise offer this form at its defaults, and
    // saving it renames the site to "Blysis" and empties every social link.
    const { loading, failed, retry } = useSettingsLoad((s) => {
        setForm({
            // Empty rather than the product's own name: a read that fell back
            // to it and then saved would rename the operator's site after the
            // thing it was built from.
            siteName: (s.siteName as string) || "",
            [SITE_LOGO_KEY]: (s[SITE_LOGO_KEY] as string) || "",
            siteDescription: (s.siteDescription as string) || "",
            serverIp: (s.serverIp as string) || "",
            contactEmail: (s.contactEmail as string) || "",
            socialFacebook: (s.socialFacebook as string) || "",
            socialInstagram: (s.socialInstagram as string) || "",
            socialTwitter: (s.socialTwitter as string) || "",
            socialYoutube: (s.socialYoutube as string) || "",
            socialDiscord: (s.socialDiscord as string) || "",
            timezone: (s.site_timezone as string) || "UTC",
        });
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
                // `timezone` is the field's name; `site_timezone` is the row
                // everything scheduled reads.
                body: JSON.stringify({ ...form, site_timezone: form.timezone, timezone: undefined }),
            });

            if (!res.ok) {
                setError(t("siteSettings_saveFailed"));
                return;
            }

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
                <div className="grid lg:grid-cols-2 gap-8">
                    <Card>
                        <CardHeader>
                            <CardTitle>{t("siteSettings_general")}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label>{t("siteSettings_siteName")}</Label>
                                <Input
                                    aria-label={t("siteSettings_siteName")}
                                    value={form.siteName}
                                    onChange={(e) => setForm({ ...form, siteName: e.target.value })}
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
                                    value={form.siteDescription}
                                    onChange={(e) => setForm({ ...form, siteDescription: e.target.value })}
                                    rows={3}
                                />
                            </div>
                            <div>
                                <Label htmlFor="site-timezone">{t("siteSettings_timezone")}</Label>
                                <NativeSelect
                                    id="site-timezone"
                                    className="mt-1"
                                    value={form.timezone}
                                    onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                                >
                                    {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                                </NativeSelect>
                                <p className="mt-1 text-sm text-muted-foreground">{t("siteSettings_timezoneHint")}</p>
                            </div>
                            <div>
                                <Label>{t("siteSettings_serverIp")}</Label>
                                <Input
                                    aria-label={t("siteSettings_serverIp")}
                                    value={form.serverIp}
                                    onChange={(e) => setForm({ ...form, serverIp: e.target.value })}
                                    placeholder="play.example.com"
                                />
                            </div>
                            <div>
                                <Label>{t("siteSettings_contactEmail")}</Label>
                                <Input
                                    aria-label={t("siteSettings_contactEmail")}
                                    type="email"
                                    value={form.contactEmail}
                                    onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
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
                            <div>
                                <Label>Discord</Label>
                                <Input
                                    aria-label="Discord"
                                    value={form.socialDiscord}
                                    onChange={(e) => setForm({ ...form, socialDiscord: e.target.value })}
                                    placeholder="https://discord.gg/..."
                                />
                            </div>
                            <div>
                                <Label>Twitter / X</Label>
                                <Input
                                    aria-label="Twitter / X"
                                    value={form.socialTwitter}
                                    onChange={(e) => setForm({ ...form, socialTwitter: e.target.value })}
                                    placeholder="https://twitter.com/..."
                                />
                            </div>
                            <div>
                                <Label>YouTube</Label>
                                <Input
                                    aria-label="YouTube"
                                    value={form.socialYoutube}
                                    onChange={(e) => setForm({ ...form, socialYoutube: e.target.value })}
                                    placeholder="https://youtube.com/..."
                                />
                            </div>
                            <div>
                                <Label>Instagram</Label>
                                <Input
                                    aria-label="Instagram"
                                    value={form.socialInstagram}
                                    onChange={(e) => setForm({ ...form, socialInstagram: e.target.value })}
                                    placeholder="https://instagram.com/..."
                                />
                            </div>
                            <div>
                                <Label>Facebook</Label>
                                <Input
                                    aria-label="Facebook"
                                    value={form.socialFacebook}
                                    onChange={(e) => setForm({ ...form, socialFacebook: e.target.value })}
                                    placeholder="https://facebook.com/..."
                                />
                            </div>
                        </CardContent>
                    </Card>
                </div>

            </form>
        </>
    );
}
