"use client";

import { createElement, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Package } from "lucide-react";
import { NavIcon } from "@/core/components/ui/NavIcon";
import { ModuleNavGroups } from "@/core/generated/module-registry";
import {
    buildNavGroups,
    buildThemeNavGroup,
    type NavGroup,
    type NavIconComponent,
} from "@/core/lib/admin-nav-groups";

/**
 * The admin navigation, built once and read by everything that names a page.
 *
 * The sidebar built it and the breadcrumb did not, which is why the sidebar
 * said "Ödeme Ayarları" while the breadcrumb above it said "Payments" - the
 * breadcrumb was titlecasing the URL segment. Every label the panel can show
 * for a route already exists in these groups, translated, so both read them
 * from here.
 */

export interface AdminNavModule {
    id: string;
    menu?: { path: string; label: string; icon?: string; group?: string }[];
}

/**
 * Resolves a Lucide icon name (as stored on a module menu item) to its
 * React component. Falls back to Package so unknown icons still render.
 */
/**
 * A module's menu icon, named in its manifest and drawn from that name.
 *
 * Core's own groups import the fifty icons they use by name, which a bundler
 * shakes down to fifty. A module's name arrives as data, and answering it used
 * to mean `import * as LucideIcons` plus `lib[name]`: a namespace import
 * cannot be shaken, so every one of the 1,723 icon modules landed in the admin
 * shell's chunk group. Measured on a production build, 191 KB gzipped on each
 * of 48 admin routes.
 *
 * `NavIcon` fetches the one icon's own chunk instead. It is wrapped rather
 * than rendered here because the sidebar's contract is a component, and the
 * wrappers are cached by name so React sees the same type between renders -
 * a fresh function per render remounts the icon on every keystroke elsewhere
 * on the screen.
 */
const wrappers = new Map<string, NavIconComponent>();

export function resolveIcon(name: string | undefined): NavIconComponent {
    if (!name) return Package;
    const cached = wrappers.get(name);
    if (cached) return cached;
    // Both props, not just the class: the rail sizes with the attribute, and
    // an icon that ignores it comes out at lucide's own default beside core's.
    const wrapper: NavIconComponent = ({ className, size }) =>
        createElement(NavIcon, { name, className, size, fallback: Package });
    wrappers.set(name, wrapper);
    return wrapper;
}

export function useAdminNav(modules: AdminNavModule[], activeThemeId?: string): NavGroup[] {
    const t = useTranslations("admin");

    return useMemo(() => {
        // Only groups declared by a module that is actually installed here -
        // the registry lists every module's declaration, installed or not.
        const enabled = new Set(modules.map((m) => m.id));
        return buildNavGroups({
            modules,
            navGroups: ModuleNavGroups.filter((g) => enabled.has(g.module)),
            themeGroup: activeThemeId ? buildThemeNavGroup(activeThemeId) : null,
            translate: (key, fallback) => (t.has(key) ? t(key) : fallback),
            resolveIcon,
        });
    }, [modules, activeThemeId, t]);
}
