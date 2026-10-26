"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "@/core/lib/i18n/navigation";
import { useSiteSettings } from "@/core/hooks/useSiteSettings";
import { useAllModules } from "@/core/providers/module-provider";
import { ModuleNavLinks, ModuleRoutes } from "@/core/generated/module-registry";
import { isEnabledIn } from "@/core/lib/module-enabled";

export interface NavLink {
    label: string;
    labelKey?: string;
    href: string;
    icon?: string;
    children?: { label: string; labelKey?: string; href: string; icon?: string }[];
}

export interface NavLinks {
    /** What the site's navigation offers, filtered and in the reader's language. */
    links: NavLink[];
    /** True when an admin arranged the bar, which is then drawn as arranged. */
    arranged: boolean;
    /** Whether a link leads to the page being read, or to one beneath it. */
    isActive: (href: string) => boolean;
}

/**
 * The site's navigation, as every bar that draws it has to see it.
 *
 * The rules lived inside the navbar: the admin's own list over the modules'
 * registered links, a module's link hidden while the module is off, each
 * label in the reader's language. A theme that draws its navigation down the
 * left edge needs the same list, and a copy of the rules would drift from
 * the bar the operator edits. So the bar and any theme ask this.
 */
export function useNavLinks(): NavLinks {
    const t = useTranslations("nav");
    const pathname = usePathname();
    const { settings } = useSiteSettings();
    const moduleStatus = useAllModules();

    // Build nav links: admin-configured links take priority, fallback to module-registered links
    // pathToModule maps top-level path prefixes to module IDs using both navLinks and routes
    const pathToModule: Record<string, string> = {};
    for (const nl of ModuleNavLinks) { pathToModule[nl.href] = nl.module; }
    for (const r of ModuleRoutes) {
        if (!r.isAdmin) {
            const prefix = '/' + r.path.split('/')[0];
            if (!pathToModule[prefix]) pathToModule[prefix] = r.module;
        }
    }

    // Installed module path prefixes (only from currently installed/enabled modules)
    const installedModulePaths = new Set<string>();
    for (const nl of ModuleNavLinks) {
        if (isEnabledIn(moduleStatus, nl.module)) installedModulePaths.add(nl.href);
    }
    for (const r of ModuleRoutes) {
        if (!r.isAdmin && isEnabledIn(moduleStatus, r.module)) {
            installedModulePaths.add('/' + r.path.split('/')[0]);
        }
    }

    // Core paths that are always valid (not served by modules)
    const corePaths = new Set(['/', '/profile', '/admin', '/auth', '/terms', '/privacy', '/rules', '/refund']);

    // When admin has explicitly configured navbar_links, we use a permissive filter:
    // only hide links that are *known* to belong to a disabled/uninstalled module.
    // When using auto-generated registry links, be strict and hide unknown paths.
    const adminConfigured = Array.isArray(settings.navbar_links);

    const isLinkEnabled = (href: string) => {
        // Dropdown parent placeholders ("#") - always allowed; children are filtered separately
        if (!href || href === "#") return true;
        // External URLs always allowed
        if (href.startsWith('http')) return true;
        // Core paths always allowed
        if (corePaths.has(href)) return true;
        // Check if this href maps to a known module
        const moduleId = pathToModule[href];
        if (moduleId) return isEnabledIn(moduleStatus, moduleId);
        // For DB-saved links: if the path is served by an installed module, allow it
        if (installedModulePaths.has(href)) return true;
        // If admin explicitly configured these links, trust unknown paths
        // (they may point to static pages, external redirects, or custom routes)
        if (adminConfigured) return true;
        // Auto-generated registry links: unknown internal path not served by any installed module - hide it
        return false;
    };

    // A module's nav entry is its own name in the site's navigation, and it was
    // the one string on the bar that never followed the locale: "Store" sitting
    // next to a translated "Home". The manifest now carries `labelKey` and the
    // module already shipped the string under the `nav` namespace; `label`
    // remains the fallback for a module that declares no key, and for an admin
    // who typed their own text in the navbar editor.
    const navLabel = (link: { label: string; labelKey?: string }) =>
        link.labelKey && t.has(link.labelKey) ? t(link.labelKey) : link.label;

    // Default links: Home + enabled module navLinks from registry
    const registryLinks = [
        { label: t('home'), href: "/", icon: "Home" },
        ...ModuleNavLinks
            .filter(nl => isEnabledIn(moduleStatus, nl.module))
            .map(nl => ({ label: navLabel(nl), href: nl.href, icon: nl.icon || "Package" })),
    ];

    const rawNavLinks = (Array.isArray(settings.navbar_links) ? settings.navbar_links : registryLinks) as NavLink[];

    // Filter out disabled module links (including from dropdown children)
    const navLinks = rawNavLinks
        .filter((link) => isLinkEnabled(link.href))
        .map((link) => {
            if (link.children) {
                const filtered = link.children.filter((child) => isLinkEnabled(child.href));
                if (filtered.length === 0) return null;
                return { ...link, label: navLabel(link), children: filtered.map((c) => ({ ...c, label: navLabel(c) })) };
            }
            return { ...link, label: navLabel(link) };
        })
        .filter(Boolean) as NavLink[];

    const isActive = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);

    return { links: navLinks, arranged: adminConfigured, isActive };
}
