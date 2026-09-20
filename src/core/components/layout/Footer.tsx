"use client";

import { Link, usePathname, useRouter } from "@/core/lib/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Globe, Mail, Users } from "lucide-react";
import { serverConfig } from "@/core/config/server";
import { localeNames, locales, type Locale } from "@/core/lib/i18n/config";
import { useSiteSettings } from "@/core/hooks/useSiteSettings";
import { useAllModules } from "@/core/providers/module-provider";
import { ModuleFooterLinks, ModuleNavLinks, ModuleRoutes, ModuleFooterComponents } from "@/core/generated/module-registry";
import { FooterComponentRegistry } from "@/core/generated/module-components";
import { ModuleErrorBoundary } from "@/core/components/ModuleErrorBoundary";
import { FooterDropdown } from "@/core/components/ui/footer-dropdown";
import { FooterColumn } from "@/core/components/layout/FooterColumn";
import { Slot } from "@/core/components/Slot";
import { NavIcon } from "@/core/components/ui/NavIcon";
import { drawnFooterColumns, legacyColumns, parseFooterColumns, type FooterColumnLink } from "@/core/lib/footer-columns";
import { VENDOR_NAME, VENDOR_URL } from "@/core/config/vendor";


const FOOTER_LINK_CLASS = "text-muted-foreground hover:text-foreground transition-colors";

/** Indexed by column count. Literal, because Tailwind scans for the string. */
const GRID_COLUMNS = [
    "md:grid-cols-1",
    "md:grid-cols-1",
    "md:grid-cols-2",
    "md:grid-cols-3",
    "md:grid-cols-4",
    "md:grid-cols-5",
    "md:grid-cols-6",
] as const;

/** Internal links go through next-intl's locale-aware Link; external ones don't. */
function FooterLinkItem({ link }: { link: FooterColumnLink }) {
    const inside = (
        <>
            <NavIcon name={link.icon} className="w-4 h-4 shrink-0" />
            {link.label}
        </>
    );
    const className = `${FOOTER_LINK_CLASS} inline-flex items-center gap-2`;
    if (link.external) {
        return (
            <a href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
                {inside}
            </a>
        );
    }
    return <Link href={link.href} className={className}>{inside}</Link>;
}

function DefaultFooter() {
    const t = useTranslations('footer');
    const commonT = useTranslations('common');
    const navT = useTranslations('nav');
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    const moduleStatus = useAllModules();
    const { settings } = useSiteSettings();

    // Prefer DB settings, fall back to serverConfig defaults
    const siteName = (settings.site_name as string) || serverConfig.name;
    const siteDescription = (settings.footer_about_text as string)
        || (settings.site_description as string)
        || serverConfig.description;
    const siteEmail = (settings.site_email as string) || serverConfig.email;
    // site_discord_url is the canonical key; hero_discord_url is read as a
    // back-compat fallback for installs migrated from older versions where
    // the Discord URL lived under the (misnamed) hero_* namespace.
    const communityUrl = (settings.site_discord_url as string)
        || (settings.hero_discord_url as string)
        || serverConfig.communityUrl;

    // Build path→module map from registry - zero hardcoded module names
    const pathToModule: Record<string, string> = {};
    for (const fl of ModuleFooterLinks) { pathToModule[fl.href] = fl.module; }
    for (const nl of ModuleNavLinks) { pathToModule[nl.href] = nl.module; }
    for (const r of ModuleRoutes) {
        if (!r.isAdmin) {
            const prefix = '/' + r.path.split('/')[0];
            if (!pathToModule[prefix]) pathToModule[prefix] = r.module;
        }
    }

    // Installed module path prefixes
    const installedModulePaths = new Set<string>();
    for (const nl of ModuleNavLinks) {
        if (isEnabledIn(moduleStatus, nl.module)) installedModulePaths.add(nl.href);
    }
    for (const fl of ModuleFooterLinks) {
        if (isEnabledIn(moduleStatus, fl.module)) installedModulePaths.add(fl.href);
    }
    for (const r of ModuleRoutes) {
        if (!r.isAdmin && isEnabledIn(moduleStatus, r.module)) {
            installedModulePaths.add('/' + r.path.split('/')[0]);
        }
    }

    // Module footer links grouped by the section they declare. Core renders
    // two named columns; a link naming any other section joins Quick Links
    // rather than vanishing, which is what filtering on `section === "quick"`
    // silently did to it.
    const enabledFooterLinks = ModuleFooterLinks.filter((fl) => isEnabledIn(moduleStatus, fl.module));

    // An install that has never opened the footer editor keeps the two
    // columns it had, read out of the settings that still hold them.
    //
    // Same as the navbar: the module's own name in the footer follows the
    // locale when the manifest declares a key, and falls back to the manifest
    // label when it does not. Links the admin typed have no key and stay put.
    const saved = parseFooterColumns(settings.footer_columns);
    const columns = drawnFooterColumns(
        saved ?? legacyColumns(settings.footer_quick_links, settings.footer_legal_links),
        enabledFooterLinks,
        { home: commonT('home'), moduleLink: (key) => (navT.has(key) ? navT(key) : null) },
    );
    const filled = columns.filter((column) => column.links.length > 0);

    // Brand, the operator's columns, and settings. An empty column would
    // leave a hole in the grid rather than a narrower one, so it is dropped
    // above and the grid narrows to match. The classes are written out because
    // Tailwind reads this file as text: an interpolated `grid-cols-${n}` is a
    // class it never generates and the grid silently collapses to one column.
    const columnClass = GRID_COLUMNS[Math.min(filled.length + 2, GRID_COLUMNS.length - 1)];

    const handleLocaleChange = (newLocale: string) => {
        router.replace(pathname, { locale: newLocale });
    };

    return (
        <>
        <footer className="bg-card text-card-foreground border-t border-border mt-12">
            <Slot name="footer.top" />
            <div className="container mx-auto px-4 py-12">
                <div className={`grid ${columnClass} gap-8`}>
                    {/* Brand */}
                    <div>
                        <div className="flex items-center gap-3 mb-4">
                            <span className="text-foreground font-bold text-lg">{siteName}</span>
                        </div>
                        {siteDescription && (
                            <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                                {siteDescription}
                            </p>
                        )}
                        <ul className="flex gap-3 list-none p-0" aria-label={navT('social')}>
                            {serverConfig.social.facebook && (
                                <li><a href={serverConfig.social.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors text-xs font-bold">
                                    <span aria-hidden="true">f</span>
                                </a></li>
                            )}
                            {serverConfig.social.instagram && (
                                <li><a href={serverConfig.social.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors text-xs font-bold">
                                    <span aria-hidden="true">ig</span>
                                </a></li>
                            )}
                            {serverConfig.social.twitter && (
                                <li><a href={serverConfig.social.twitter} target="_blank" rel="noopener noreferrer" aria-label="X (Twitter)" className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors text-xs font-bold">
                                    <span aria-hidden="true">X</span>
                                </a></li>
                            )}
                            {serverConfig.social.youtube && (
                                <li><a href={serverConfig.social.youtube} target="_blank" rel="noopener noreferrer" aria-label="YouTube" className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors text-xs font-bold">
                                    <span aria-hidden="true">yt</span>
                                </a></li>
                            )}
                            {communityUrl && (
                                <li><a href={communityUrl} target="_blank" rel="noopener noreferrer" aria-label={navT('community')} className="w-8 h-8 rounded-full bg-white/10 hover:bg-primary flex items-center justify-center transition-colors">
                                    <Users className="w-4 h-4" aria-hidden="true" />
                                </a></li>
                            )}
                        </ul>
                    </div>

                    {/* The operator's columns, plus whatever modules contributed
                        to each. Core names no page and no section of its own. */}
                    {filled.map((column, index) => (
                        <FooterColumn
                            key={column.title ?? column.titleKey ?? index}
                            title={column.titleKey && t.has(column.titleKey) ? t(column.titleKey) : column.title}
                        >
                            <ul className="space-y-2 text-sm">
                                {column.links.map(fl => (
                                    <li key={fl.href}><FooterLinkItem link={fl} /></li>
                                ))}
                            </ul>
                        </FooterColumn>
                    ))}

                    {/* Settings */}
                    <FooterColumn title={commonT('settings')}>
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Globe className="w-4 h-4 text-muted-foreground" />
                                <FooterDropdown
                                    options={locales}
                                    value={locale}
                                    onChange={handleLocaleChange}
                                    formatLabel={(l) => localeNames[l as Locale]}
                                />
                            </div>
                            {ModuleFooterComponents
                                .filter((fc) => isEnabledIn(moduleStatus, fc.module) && FooterComponentRegistry[fc.id])
                                .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
                                .map((fc) => {
                                    const Comp = FooterComponentRegistry[fc.id];
                                    return (
                                        <ModuleErrorBoundary key={fc.id}>
                                            <Comp />
                                        </ModuleErrorBoundary>
                                    );
                                })}
                        </div>

                        {siteEmail && (
                            <div className="mt-6">
                                <p className="text-muted-foreground text-sm flex items-center gap-2">
                                    <Mail className="w-4 h-4" />
                                    {siteEmail}
                                </p>
                            </div>
                        )}
                    </FooterColumn>
                </div>
            </div>

            {/* Bottom Bar */}
            <div className="border-t border-white/10">
                <div className="container mx-auto px-4 py-4">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <p className="text-muted-foreground text-sm">
                            {(settings.footer_copyright as string)
                                || `© ${new Date().getFullYear()} ${siteName}. ${t('allRightsReserved')}`}
                        </p>
                        {/* One sentence, one key. Three keys glued together read
                            as "Built with by Blysis" in English and came out in
                            the wrong order in Turkish, where the verb is last. */}
                        <p className="text-sm text-muted-foreground">
                            {t.rich('madeBy', {
                                vendor: VENDOR_NAME,
                                link: (chunks) => (
                                    <a
                                        href={VENDOR_URL}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary font-medium hover:underline underline-offset-4 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                    >
                                        {chunks}
                                    </a>
                                ),
                            })}
                        </p>
                    </div>
                </div>
            </div>
        </footer>
        <Slot name="layout.bottom" />
        </>
    );
}

import { ThemeComponentSlot } from "@/core/components/theme/ThemeComponentSlot";
import { isEnabledIn } from "@/core/lib/module-enabled";

export function Footer() {
    return <ThemeComponentSlot name="Footer" fallback={DefaultFooter} />;
}
