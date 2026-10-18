"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/core/components/ui/input";
import { NativeSelect } from "@/core/components/ui/native-select";
import { localeNames, locales } from "@/core/lib/i18n/config";

/**
 * Locales the wizard offers: every one the site ships, named in itself.
 *
 * This was a hand-written list, and it offered German, Spanish, French,
 * Russian and Portuguese while the site shipped only English and Turkish -
 * picking one saved a default locale the router then refused.
 */
const LOCALE_OPTIONS = locales.map((code) => ({ code, label: localeNames[code] }));

interface SiteStepProps {
    siteName: string;
    siteDescription: string;
    defaultLocaleCode: string;
    setSiteName: (v: string) => void;
    setSiteDescription: (v: string) => void;
    setDefaultLocaleCode: (v: string) => void;
}

export function SiteStep({
    siteName, siteDescription, defaultLocaleCode,
    setSiteName, setSiteDescription, setDefaultLocaleCode,
}: SiteStepProps) {
    const t = useTranslations("setup.site");
    return (
        <div className="space-y-4">
            <h1 className="text-xl font-bold text-foreground">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
            <div className="space-y-3">
                <label className="block">
                    <span className="text-sm font-medium text-foreground">{t("name")}</span>
                    <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} />
                </label>
                <label className="block">
                    <span className="text-sm font-medium text-foreground">{t("descriptionField")}</span>
                    <Input value={siteDescription} onChange={(e) => setSiteDescription(e.target.value)} />
                    <span className="text-xs text-muted-foreground">{t("descriptionHint")}</span>
                </label>
                <label className="block">
                    <span className="text-sm font-medium text-foreground">{t("locale")}</span>
                    <NativeSelect
                        value={defaultLocaleCode}
                        onChange={(e) => setDefaultLocaleCode(e.target.value)} className="w-full mt-1"
                    >
                        {LOCALE_OPTIONS.map((l) => (
                            <option key={l.code} value={l.code}>{l.label}</option>
                        ))}
                    </NativeSelect>
                </label>
            </div>
        </div>
    );
}
