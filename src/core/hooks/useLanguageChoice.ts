"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/core/lib/i18n/navigation";
import { useSiteSettings } from "@/core/hooks/useSiteSettings";
import { localeNames, type Locale } from "@/core/lib/i18n/config";
import { siteLanguagesOf } from "@/core/lib/i18n/site-languages";

export interface LanguageChoice {
    /** The language the page is being read in. */
    locale: string;
    /** Every language the site offers, each named in itself. */
    options: { value: Locale; label: string }[];
    /** Read this page in another language. */
    choose: (locale: string) => void;
}

/**
 * The language a visitor reads the site in, and the way to change it.
 *
 * Core's footer offers this in a menu of its own; a theme that puts the
 * choice somewhere else, in its own control, asks here, so the page it moves
 * to is the same page in the other language whichever control was used.
 * Only the languages the operator offers are listed. Until the site's
 * settings arrive that is every language, which is what a site that never
 * chose offers anyway.
 */
export function useLanguageChoice(): LanguageChoice {
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    const { settings } = useSiteSettings();
    const site = siteLanguagesOf(settings.site_languages, settings.default_locale);
    return {
        locale,
        options: site.offered.map((value) => ({ value, label: localeNames[value] })),
        choose: (next) => router.replace(pathname, { locale: next }),
    };
}
