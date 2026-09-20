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
 * The mark this installation put on itself, or null.
 *
 * Null is an answer: the caller falls back to the icon this installation
 * already ships and that a browser shows in its tab. The rail used to draw
 * the site's initials instead, so an installation that had not opened the
 * settings screen wore two letters in the corner of every admin page.
 */
/**
 * The site's mark, wherever one is drawn.
 *
 * The logo an operator set, and otherwise the icon this installation already
 * ships and a browser already shows in its tab. It was written out twice with
 * two different fallbacks - the admin rail drew the site's initials, and the
 * public bar drew a house icon and the word "home" - so an operator who
 * uploaded a logo saw it in one of the two places it belongs.
 *
 * A plain `img`: the address is whatever they uploaded or linked, and which
 * storage provider answered is not core's business to optimise.
 */
export function SiteMark({ size = 24, className }: { size?: number; className?: string }) {
    const logo = useSiteLogo();
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={logo || "/icon.svg"}
            alt=""
            aria-hidden="true"
            width={size}
            height={size}
            className={className ?? "object-contain shrink-0"}
            style={{ width: size, height: size }}
        />
    );
}

export function useSiteLogo(): string | null {
    const { settings } = useSiteSettings();
    return siteLogo(settings[SITE_LOGO_KEY]);
}
