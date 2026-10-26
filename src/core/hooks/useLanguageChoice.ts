"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/core/lib/i18n/navigation";
import { localeNames, locales, type Locale } from "@/core/lib/i18n/config";

export interface LanguageChoice {
    /** The language the page is being read in. */
    locale: string;
    /** Every language the site serves, each named in itself. */
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
 */
export function useLanguageChoice(): LanguageChoice {
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    return {
        locale,
        options: locales.map((value) => ({ value, label: localeNames[value] })),
        choose: (next) => router.replace(pathname, { locale: next }),
    };
}
