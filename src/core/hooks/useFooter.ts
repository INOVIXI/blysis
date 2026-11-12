"use client";

import { useLocale, useTranslations } from "next-intl";
import { serverConfig } from "@/core/config/server";
import { ModuleFooterLinks } from "@/core/generated/module-registry";
import { useSiteSettings } from "@/core/hooks/useSiteSettings";
import { defaultFooterColumns, drawnFooterColumns, parseFooterColumns, parseHiddenLinks, type FooterColumnLink } from "@/core/lib/footer-columns";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { SITE_SOCIAL_LINKS, type SiteSocialLink } from "@/core/lib/site-contact";
import { useAllModules } from "@/core/providers/module-provider";
import { useText } from "@/core/hooks/useText";

/**
 * A setting with something in it. Each key is read as `settings.<key>` at the
 * call, which is how `site-settings-reach-their-readers` finds what this file
 * needs `/api/v1/public-settings` to publish.
 */
function filled(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** A place the site can be found off the site. `name` says which, for its mark. */
export interface FooterSocialLink {
    name: SiteSocialLink["name"];
    /** What to call it, in the reader's language where it has one. */
    label: string;
    href: string;
}

export interface FooterContentColumn {
    /** The operator's heading, or core's in the reader's language. */
    title: string;
    links: FooterColumnLink[];
}

export interface FooterContent {
    siteName: string;
    /** The line under the name: the operator's footer text, else the site's description. */
    about: string | null;
    email: string | null;
    social: FooterSocialLink[];
    /** Only the columns with something in them, in the operator's order. */
    columns: FooterContentColumn[];
    /** The operator's own line, or null for the theme's way of saying it. */
    copyright: string | null;
}

/**
 * What the site's footer says, as every footer that draws it has to see it.
 *
 * The rules lived inside core's footer: the operator's columns over the two
 * legacy settings, each module's link placed in the column that adopts its
 * section, a disabled module's left out, and core's own headings in the
 * reader's language. A theme drawing a footer of its own needs exactly that,
 * and a copy of the rules would drift from the editor the operator uses, so
 * core's footer and any theme's ask this.
 */
export function useFooter(): FooterContent {
    const t = useTranslations("footer");
    const commonT = useTranslations("common");
    const navT = useTranslations("nav");
    const moduleStatus = useAllModules();
    // The name, the about line and the copyright are the operator's prose,
    // which may be written per language; read in the reader's before the
    // "is anything there" test, which only a string can pass.
    const text = useText();
    const locale = useLocale();
    const { settings } = useSiteSettings();

    const enabledFooterLinks = ModuleFooterLinks.filter((fl) => isEnabledIn(moduleStatus, fl.module));
    // An install that has never saved a footer is drawn the default one: the
    // two columns it had, read out of the settings that still hold them, and
    // a column for each section its modules name.
    // Headings and labels the operator wrote per language, in the reader's.
    const saved = parseFooterColumns(settings.footer_columns, locale);
    const columns = drawnFooterColumns(
        saved ?? defaultFooterColumns(settings.footer_quick_links, settings.footer_legal_links, enabledFooterLinks),
        enabledFooterLinks,
        { home: commonT("home"), moduleLink: (key) => (navT.has(key) ? navT(key) : null) },
        parseHiddenLinks(settings.footer_hidden_links),
    )
        // An empty column would leave a hole where a narrower footer belongs.
        .filter((column) => column.links.length > 0)
        .map((column) => ({
            title: column.titleKey && t.has(column.titleKey) ? t(column.titleKey) : (column.title ?? ""),
            links: column.links,
        }));

    // Each address is a setting, published by `/api/v1/public-settings` with
    // the documented environment variables already filled in on the server.
    // site_discord_url is the canonical key; hero_discord_url is read as a
    // back-compat fallback for installs migrated from older versions where
    // the Discord URL lived under the (misnamed) hero_* namespace.
    const addresses: Record<string, string | null> = {
        site_facebook_url: filled(settings.site_facebook_url),
        site_instagram_url: filled(settings.site_instagram_url),
        site_x_url: filled(settings.site_x_url),
        site_youtube_url: filled(settings.site_youtube_url),
        site_tiktok_url: filled(settings.site_tiktok_url),
        site_discord_url: filled(settings.site_discord_url) ?? filled(settings.hero_discord_url),
    };
    const social: FooterSocialLink[] = SITE_SOCIAL_LINKS.flatMap((link) => {
        const href = addresses[link.key];
        return href ? [{ name: link.name, label: link.name === "community" ? navT("community") : link.label, href }] : [];
    });

    return {
        siteName: filled(text(settings.site_name)) ?? serverConfig.name,
        about: filled(text(settings.footer_about_text)) ?? filled(text(settings.site_description)) ?? filled(serverConfig.description),
        email: filled(settings.site_email),
        social,
        columns,
        copyright: filled(text(settings.footer_copyright)),
    };
}
