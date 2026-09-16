"use client";

import { useTranslations } from "next-intl";
import { useSiteSettings } from "@/core/hooks/useSiteSettings";
import { SITE_LOGO_KEY, siteLogo } from "@/core/lib/site-logo";

/**
 * What this installation calls itself.
 *
 * Six screens spelled the product's name into their markup - the four auth
 * pages, the password reset page and the admin rail - so every installation on
 * earth advertised the same brand on its own sign-in form, whatever the
 * operator had put in Settings. Renaming the product meant editing six
 * components, and the translation gates flagged each one as English copy,
 * which it was.
 *
 * `site_name` is already an operator setting and already public, so this reads
 * it. The fallback is a translated string rather than a constant: it is what
 * shows on an install that has not been through setup yet, and it is the one
 * place the shipped name belongs.
 */
export function SiteName({ className }: { className?: string }) {
    const t = useTranslations("common");
    const { settings } = useSiteSettings();
    const name = (settings.site_name as string)?.trim() || t("appName");
    return <span className={className}>{name}</span>;
}

/**
 * The same name reduced to what fits a 40px square.
 *
 * First letter of each of the first two words, so "Blysis" gives B and
 * "Acme Games" gives AG. A single long word falls back to its first two
 * letters rather than one lonely capital.
 */
export function useSiteInitials(): string {
    const t = useTranslations("common");
    const { settings } = useSiteSettings();
    const name = (settings.site_name as string)?.trim() || t("appName");
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

/**
 * The mark this installation put on itself, or null.
 *
 * Null is an answer, and the reason `useSiteInitials` stays: a site with no
 * logo draws its name's first letters, which is what the admin rail's square
 * did before there was a logo to draw at all.
 */
export function useSiteLogo(): string | null {
    const { settings } = useSiteSettings();
    return siteLogo(settings[SITE_LOGO_KEY]);
}
