"use client";

import { useTranslations } from "next-intl";
import { serverConfig } from "@/core/config/server";
import { ModuleFooterLinks } from "@/core/generated/module-registry";
import { useSiteSettings } from "@/core/hooks/useSiteSettings";
import { drawnFooterColumns, legacyColumns, parseFooterColumns, type FooterColumnLink } from "@/core/lib/footer-columns";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { useAllModules } from "@/core/providers/module-provider";

/**
 * A setting with something in it. Each key is read as `settings.<key>` at the
 * call, which is how `site-settings-reach-their-readers` finds what this file
 * needs `/api/v1/public-settings` to publish.
 */
function filled(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** A place the site can be found off the site. `name` says which, for its label. */
export interface FooterSocialLink {
    name: "facebook" | "instagram" | "x" | "youtube" | "community";
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
    const { settings } = useSiteSettings();

    const enabledFooterLinks = ModuleFooterLinks.filter((fl) => isEnabledIn(moduleStatus, fl.module));
    // An install that has never opened the footer editor keeps the two
    // columns it had, read out of the settings that still hold them.
    const saved = parseFooterColumns(settings.footer_columns);
    const columns = drawnFooterColumns(
        saved ?? legacyColumns(settings.footer_quick_links, settings.footer_legal_links),
        enabledFooterLinks,
        { home: commonT("home"), moduleLink: (key) => (navT.has(key) ? navT(key) : null) },
    )
        // An empty column would leave a hole where a narrower footer belongs.
        .filter((column) => column.links.length > 0)
        .map((column) => ({
            title: column.titleKey && t.has(column.titleKey) ? t(column.titleKey) : (column.title ?? ""),
            links: column.links,
        }));

    // site_discord_url is the canonical key; hero_discord_url is read as a
    // back-compat fallback for installs migrated from older versions where
    // the Discord URL lived under the (misnamed) hero_* namespace.
    const community = filled(settings.site_discord_url) ?? filled(settings.hero_discord_url) ?? serverConfig.communityUrl;
    const social: FooterSocialLink[] = [
        { name: "facebook" as const, href: serverConfig.social.facebook },
        { name: "instagram" as const, href: serverConfig.social.instagram },
        { name: "x" as const, href: serverConfig.social.twitter },
        { name: "youtube" as const, href: serverConfig.social.youtube },
        { name: "community" as const, href: community },
    ].filter((link): link is FooterSocialLink => typeof link.href === "string" && link.href !== "");

    return {
        siteName: filled(settings.site_name) ?? serverConfig.name,
        about: filled(settings.footer_about_text) ?? filled(settings.site_description) ?? filled(serverConfig.description),
        email: filled(settings.site_email) ?? filled(serverConfig.email),
        social,
        columns,
        copyright: filled(settings.footer_copyright),
    };
}
