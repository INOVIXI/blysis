/**
 * Admin sidebar navigation group definitions.
 *
 * The admin shell is a two-level navigation:
 *   1. An icon rail on the far left (w-14) with one icon per group
 *   2. A contextual sidebar (w-56) next to it showing the items for the
 *      currently-selected group
 *
 * Each top-level group contains sections with items. A section can have
 * an optional header label that renders as a small uppercase title in
 * the contextual sidebar (like "User Management", "Actions").
 *
 * Module contributions: modules declare `menu[]` in their manifest with
 * an optional `group` field naming the group to join. Items that name no
 * group - or one nothing provides - land in a catch-all bucket that is
 * only created when something needs it.
 *
 * Core items live in the `CORE_NAV_GROUPS` constant; `buildNavGroups()`
 * merges module items in and prunes whatever ends up empty.
 */

import { adminHref } from "@/core/lib/admin-path";
import { createElement, type ComponentType } from "react";
import { NavIcon } from "@/core/components/ui/NavIcon";
import {
    byDeclaringModule,
    findNavGroupConflicts,
    type ModuleNavGroupDeclaration,
    type NavGroupConflict,
} from "@/core/lib/nav-group-conflicts";
import { themeRegistry } from "@/core/generated/theme-registry";

export { findNavGroupConflicts };
export type { ModuleNavGroupDeclaration, NavGroupConflict };
import { themeAdminRoutes, type ThemeAdminNavItem } from "@/core/generated/theme-admin-routes";
import {
    LayoutDashboard,
    Users,
    FileText,
    Palette,
    Package,
    Activity,
    LineChart,
    Wrench,
    Settings,
    History,
    ShieldCheck,
    ShieldOff,
    AlertTriangle,
    ScrollText,
    Clock,
    Inbox,
    Database,
    Gauge,
    Bell,
    KeyRound,
    FileJson,
    ImageIcon,
    Languages,
    Navigation,
    PanelBottom,
    LayoutGrid,
    Code,
    Globe,
    ClipboardCheck,
    ShieldAlert,
    Megaphone,
    Server,
    Cog,
    SlidersHorizontal,
    Cpu,
    ArrowUpCircle,
} from "lucide-react";

/** Lucide-compatible icon component used across the admin sidebar. */
export type NavIconComponent = ComponentType<{ size?: number; className?: string }>;

export interface NavItem {
    href: string;
    label: string;
    labelKey?: string;
    icon?: NavIconComponent;
}

export interface NavSection {
    header?: string;
    headerKey?: string;
    items: NavItem[];
    /**
     * The name a module's `menu[].section` can point at.
     *
     * Without it a module naming "security" got a second Security section
     * below core's, reading the same word twice in one group. A section core
     * ships is the place; a module joins it rather than reinventing it.
     */
    id?: string;
}

export interface NavGroup {
    id: string;
    icon: NavIconComponent;
    label: string;
    labelKey?: string;
    sections: NavSection[];
    /** If a path under this prefix is active, this group is selected. */
    pathPrefix?: string | string[];
    /**
     * Where the group sits in the rail. Core declares its own with gaps, so a
     * group a module declares can sit between two of them - which is the whole
     * point: the screens an operator opens daily are the ones a module ships,
     * and they used to be pushed below the ones opened twice a year.
     */
    order?: number;
}

/**
 * Core navigation groups, in the order an operator reaches for them.
 *
 * The numbers leave gaps on purpose. A group a module declares names its own,
 * and the ones that matter here are 30, 40 and 50: the screens a community
 * actually runs on - a shop, a forum, whatever the site is for - used to be
 * pushed below Settings because they arrive from a module. Core cannot name
 * them, so it leaves them room instead.
 *
 * Every group here owns at least one core item, so none of them can render
 * empty. Modules extend them via `buildNavGroups()`.
 */
export const CORE_NAV_GROUPS: NavGroup[] = [
    {
        id: "dashboard",
        icon: LayoutDashboard,
        label: "Dashboard",
        labelKey: "sidebar_dashboard",
        order: 10,
        pathPrefix: ["/admin", "/admin/analytics", "/admin/observability"],
        sections: [
            {
                items: [
                    { href: "/admin", label: "Overview", labelKey: "sidebar_overview", icon: LayoutDashboard },
                    { href: "/admin/analytics", label: "Analytics", labelKey: "sidebar_analytics", icon: LineChart },
                    { href: "/admin/observability", label: "Observability", labelKey: "sidebar_observability", icon: Activity },
                ],
            },
        ],
    },
    {
        id: "content",
        icon: FileText,
        label: "Content",
        labelKey: "sidebar_content",
        order: 20,
        pathPrefix: ["/admin/moderation", "/admin/settings/moderation", "/admin/revisions", "/admin/broadcasts", "/admin/warnings", "/admin/ip-blocks"],
        sections: [
            {
                id: "publishing",
                header: "Publishing",
                headerKey: "sidebar_publishing",
                items: [
                    { href: "/admin/broadcasts", label: "Broadcasts", labelKey: "sidebar_broadcasts", icon: Megaphone },
                    { href: "/admin/revisions", label: "Revisions", labelKey: "sidebar_revisions", icon: History },
                ],
            },
            {
                // Moderation was in two groups: the queue and its settings under
                // Content, the warnings and blocks that come out of it under
                // Users. One moderator's job, two places to look for it.
                id: "moderation",
                header: "Moderation",
                headerKey: "sidebar_moderation",
                items: [
                    { href: "/admin/moderation", label: "Moderation Queue", labelKey: "sidebar_moderationQueue", icon: ShieldAlert },
                    { href: "/admin/warnings", label: "Warnings", labelKey: "sidebar_warnings", icon: AlertTriangle },
                    { href: "/admin/ip-blocks", label: "IP Blocks", labelKey: "sidebar_ipBlocks", icon: ShieldOff },
                    { href: "/admin/settings/moderation", label: "Moderation Settings", labelKey: "sidebar_moderationSettings", icon: SlidersHorizontal },
                ],
            },
        ],
    },
    {
        id: "users",
        icon: Users,
        label: "People",
        labelKey: "sidebar_people",
        order: 60,
        pathPrefix: ["/admin/users", "/admin/roles", "/admin/permissions", "/admin/resource-permissions"],
        sections: [
            {
                id: "accounts",
                header: "Accounts",
                headerKey: "sidebar_accounts",
                items: [
                    { href: "/admin/users", label: "Users", labelKey: "sidebar_users", icon: Users },
                ],
            },
            {
                id: "access",
                header: "Access",
                headerKey: "sidebar_access",
                items: [
                    { href: "/admin/roles", label: "Roles", labelKey: "sidebar_roles", icon: ShieldCheck },
                    { href: "/admin/permissions", label: "Permissions", labelKey: "sidebar_permissions", icon: ClipboardCheck },
                    { href: "/admin/resource-permissions", label: "Resource Grants", labelKey: "sidebar_resourcePermissions", icon: ShieldCheck },
                ],
            },
        ],
    },
    {
        id: "design",
        icon: Palette,
        label: "Design",
        labelKey: "sidebar_design",
        order: 70,
        pathPrefix: ["/admin/settings/navbar", "/admin/settings/footer", "/admin/settings/widgets", "/admin/settings/css", "/admin/settings/theme", "/admin/media", "/admin/translations"],
        sections: [
            {
                id: "appearance",
                header: "Appearance",
                headerKey: "sidebar_appearance",
                items: [
                    { href: "/admin/settings/theme", label: "Theme Library", labelKey: "sidebar_themeLibrary", icon: Palette },
                    { href: "/admin/settings/css", label: "Custom CSS", labelKey: "sidebar_customCss", icon: Code },
                ],
            },
            {
                id: "layout",
                header: "Layout",
                headerKey: "sidebar_layout",
                items: [
                    { href: "/admin/settings/navbar", label: "Navbar", labelKey: "sidebar_navbar", icon: Navigation },
                    { href: "/admin/settings/footer", label: "Footer", labelKey: "sidebar_footer", icon: PanelBottom },
                    { href: "/admin/settings/widgets", label: "Widgets", labelKey: "sidebar_widgets", icon: LayoutGrid },
                ],
            },
            {
                id: "media",
                header: "Media",
                headerKey: "sidebar_media",
                items: [
                    { href: "/admin/media", label: "Media Library", labelKey: "sidebar_mediaLibrary", icon: ImageIcon },
                ],
            },
            {
                id: "wording",
                header: "Wording",
                headerKey: "sidebar_wording",
                items: [
                    { href: "/admin/translations", label: "Translations", labelKey: "sidebar_translations", icon: Languages },
                ],
            },
        ],
    },
    {
        // Marketplace and Activity were top-level groups of one and two items:
        // two icons in the rail for pages nobody opens on their way anywhere.
        // What they have in common with the rest of this group is that they
        // are about the installation rather than about what it publishes.
        id: "system",
        icon: Wrench,
        label: "System",
        labelKey: "sidebar_system",
        order: 80,
        pathPrefix: ["/admin/modules", "/admin/cron", "/admin/email-queue", "/admin/backup", "/admin/updates", "/admin/api-docs", "/admin/api-keys", "/admin/dev", "/admin/system", "/admin/activity-log", "/admin/audit-log", "/admin/settings/rate-limits", "/admin/settings/alerting", "/admin/settings/maintenance"],
        sections: [
            {
                id: "modules",
                header: "Modules",
                headerKey: "sidebar_modules",
                items: [
                    { href: "/admin/modules", label: "Modules", labelKey: "sidebar_modules", icon: Package },
                ],
            },
            {
                id: "operations",
                header: "Operations",
                headerKey: "sidebar_operations",
                items: [
                    { href: "/admin/cron", label: "Cron Jobs", labelKey: "sidebar_cron", icon: Clock },
                    { href: "/admin/email-queue", label: "Email Queue", labelKey: "sidebar_emailQueue", icon: Inbox },
                    { href: "/admin/backup", label: "Backup & Restore", labelKey: "sidebar_backup", icon: Database },
                    { href: "/admin/system", label: "System Health", labelKey: "sidebar_systemHealth", icon: Server },
                    { href: "/admin/updates", label: "Updates", labelKey: "sidebar_updates", icon: ArrowUpCircle },
                ],
            },
            {
                id: "security",
                header: "Security",
                headerKey: "sidebar_security",
                items: [
                    { href: "/admin/settings/rate-limits", label: "Rate Limits", labelKey: "sidebar_rateLimits", icon: Gauge },
                    { href: "/admin/settings/alerting", label: "Health Alerts", labelKey: "sidebar_alerting", icon: Bell },
                    { href: "/admin/settings/maintenance", label: "Maintenance Mode", labelKey: "sidebar_maintenance", icon: Wrench },
                ],
            },
            {
                id: "history",
                header: "History",
                headerKey: "sidebar_history",
                items: [
                    { href: "/admin/activity-log", label: "Activity Log", labelKey: "sidebar_activityLog", icon: ScrollText },
                    { href: "/admin/audit-log", label: "Audit Log", labelKey: "sidebar_auditLog", icon: ScrollText },
                ],
            },
            {
                id: "developer",
                header: "Developer",
                headerKey: "sidebar_developer",
                items: [
                    { href: "/admin/api-docs", label: "API Reference", labelKey: "sidebar_apiDocs", icon: FileJson },
                    { href: "/admin/api-keys", label: "API Keys", labelKey: "sidebar_apiKeys", icon: KeyRound },
                    { href: "/admin/dev", label: "Hooks & Registries", labelKey: "sidebar_devTools", icon: Cpu },
                ],
            },
        ],
    },
    {
        id: "settings",
        icon: Settings,
        label: "Settings",
        labelKey: "sidebar_settings",
        order: 90,
        pathPrefix: ["/admin/settings"],
        sections: [
            {
                items: [
                    { href: "/admin/settings/general", label: "General", labelKey: "sidebar_general", icon: Cog },
                    { href: "/admin/settings/site", label: "Site Config", labelKey: "sidebar_siteConfig", icon: Globe },
                ],
            },
        ],
    },
];

/** Id of the catch-all bucket for menu items that name no group. */
export const FALLBACK_NAV_GROUP_ID = "modules";

// Render order. Every group declares its own number and core leaves gaps, so
// a group a module declares sits where it says it does rather than after
// everything core ships. A group that declares nothing goes to the end, which
// is where an unplaced thing belongs.
const FALLBACK_GROUP_ORDER = 8000;
const THEME_GROUP_ORDER = 9000;

export interface ModuleMenuContribution {
    id: string;
    menu?: { path: string; label: string; icon?: string; group?: string; section?: string }[];
}

export interface BuildNavGroupsOptions {
    /** Enabled modules only - the caller filters on `ModuleConfig.enabled`. */
    modules?: ModuleMenuContribution[];
    /** Nav groups declared by enabled modules. */
    navGroups?: ModuleNavGroupDeclaration[];
    themeGroup?: NavGroup | null;
    coreGroups?: NavGroup[];
    /** Resolves a translation key, returning `fallback` when it is missing. */
    translate?: (key: string, fallback: string) => string;
    /** Resolves a Lucide icon name from a manifest to a component. */
    resolveIcon?: (name: string | undefined) => NavIconComponent;
}

function cloneGroup(group: NavGroup): NavGroup {
    return { ...group, sections: group.sections.map((s) => ({ ...s, items: [...s.items] })) };
}

function prettifyModuleId(id: string): string {
    return id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Find the group a menu item asked for, creating the catch-all bucket when
 * nothing provides it.
 *
 * An item may name a group no installed module declares. Dropping it would
 * make that module's admin page unreachable with no visible cause, so it
 * lands in the bucket instead.
 */
function resolveGroup(
    requested: string | undefined,
    groups: NavGroup[],
    byId: Map<string, NavGroup>,
    sortOrder: Map<string, number>,
    translate: (key: string, fallback: string) => string,
): NavGroup {
    const existing = requested ? byId.get(requested) : undefined;
    if (existing) return existing;

    const bucket = byId.get(FALLBACK_NAV_GROUP_ID);
    if (bucket) return bucket;

    const created: NavGroup = {
        id: FALLBACK_NAV_GROUP_ID,
        icon: Package,
        label: translate("sidebar_modules", "Modules"),
        labelKey: "sidebar_modules",
        sections: [],
    };
    byId.set(created.id, created);
    sortOrder.set(created.id, FALLBACK_GROUP_ORDER);
    groups.push(created);
    return created;
}

/**
 * Merge module menu contributions into the nav groups, then drop everything
 * that ended up empty.
 *
 * Core ships only the groups it fills itself. A group declared purely for
 * modules to populate renders as a dead entry in the icon rail when nothing
 * is installed - preventing that is this function's job: sections with no
 * items, and groups with no sections, never reach the caller.
 *
 * Modules are processed in lexical id order so the rendered sidebar does not
 * depend on install order or filesystem enumeration.
 */
export function buildNavGroups({
    modules = [],
    navGroups = [],
    themeGroup = null,
    coreGroups = CORE_NAV_GROUPS,
    translate = (_key, fallback) => fallback,
    resolveIcon = () => Package,
}: BuildNavGroupsOptions = {}): NavGroup[] {
    const groups: NavGroup[] = coreGroups.map(cloneGroup);
    const sortOrder = new Map<string, number>();
    groups.forEach((group, index) => sortOrder.set(group.id, group.order ?? index));

    // Modules may declare groups core does not ship, and several modules may
    // declare the same one - a storefront and a credits module both belong
    // under Commerce. The first declaration by module id wins the label and
    // icon; every declaring module still contributes its items.
    // `findNavGroupConflicts` reports disagreements at validation time.
    for (const declaration of [...navGroups].sort(byDeclaringModule)) {
        if (sortOrder.has(declaration.id)) continue;
        groups.push({
            id: declaration.id,
            icon: resolveIcon(declaration.icon),
            // The manifest's label is English, the way a manifest's strings
            // always are; the declaring module ships the translation under
            // the derived key, the same as it does for its menu entries.
            label: translate(`navGroup_${declaration.id}`, declaration.label),
            labelKey: `navGroup_${declaration.id}`,
            sections: [],
        });
        sortOrder.set(declaration.id, declaration.order ?? FALLBACK_GROUP_ORDER);
    }

    if (themeGroup) {
        groups.push(cloneGroup(themeGroup));
        sortOrder.set(themeGroup.id, THEME_GROUP_ORDER);
    }

    const byId = new Map(groups.map((g) => [g.id, g]));

    // One named section per multi-item module; the single-item ones share a
    // tail section per group, because a wall of one-item headers reads worse
    // than a single "Extensions" list.
    //
    // "Tail" is the point of it and it was not being kept: sections are
    // appended as the modules are walked, in lexical id order, so Commerce
    // put `currency` in the pooled section before it ever reached `store`
    // and the panel read "EXTENSIONS - Currency" above "STORE - Products,
    // Orders, ...". The pooled section is moved to the end of its group
    // below, once every module has had its turn.
    const namedSections = new Map<string, NavSection>();
    const sharedSections = new Map<string, NavSection>();
    const pooledSections = new Map<string, NavSection>();

    // A core section that named itself is already the place a module means.
    const coreSections = new Set<NavSection>();
    for (const group of groups) {
        for (const section of group.sections) {
            if (!section.id) continue;
            sharedSections.set(`${group.id}::section::${section.id}`, section);
            coreSections.add(section);
        }
    }

    for (const mod of [...modules].sort((a, b) => a.id.localeCompare(b.id))) {
        if (!mod.menu || mod.menu.length === 0) continue;

        const moduleLabel = translate(`menu_${mod.id}`, prettifyModuleId(mod.id));
        const isMulti = mod.menu.length > 1;

        for (const entry of mod.menu) {
            const group = resolveGroup(entry.group, groups, byId, sortOrder, translate);
            const labelKey = `menu_${mod.id}_${entry.label.replace(/\s+/g, "_").toLowerCase()}`;
            const item: NavItem = {
                href: adminHref(entry.path),
                label: translate(labelKey, entry.label),
                icon: resolveIcon(entry.icon),
            };

            // A section several modules share. Fourteen payment providers are
            // a category, and they were falling one by one into the pooled
            // drawer under Settings while the page that configures payment sat
            // in Commerce. Naming the section is how a module that ships one
            // page says what kind of thing it is.
            if (entry.section) {
                const key = `${group.id}::section::${entry.section}`;
                let section = sharedSections.get(key);
                if (!section) {
                    section = {
                        header: translate(`navSection_${entry.section}`, entry.section),
                        headerKey: `navSection_${entry.section}`,
                        items: [],
                    };
                    sharedSections.set(key, section);
                    group.sections.push(section);
                }
                section.items.push(item);
            } else if (isMulti) {
                const key = `${group.id}::${mod.id}`;
                let section = namedSections.get(key);
                if (!section) {
                    section = { header: moduleLabel, items: [] };
                    namedSections.set(key, section);
                    group.sections.push(section);
                }
                section.items.push(item);
            } else {
                let section = pooledSections.get(group.id);
                if (!section) {
                    section = {
                        header: translate("sidebar_extensions", "Extensions"),
                        headerKey: "sidebar_extensions",
                        items: [],
                    };
                    pooledSections.set(group.id, section);
                    group.sections.push(section);
                }
                section.items.push(item);
            }
        }
    }

    const pooled = new Set(pooledSections.values());
    const shared = new Set([...sharedSections.values()].filter((s) => !coreSections.has(s)));

    return groups
        .map((group) => {
            const kept = group.sections.filter((s) => s.items.length > 0);
            // Core's own sections first, then the ones a module named for
            // itself, then the ones several modules share, then the drawer.
            // The drawer is last whatever order the modules that filled it
            // happened to be walked in, and a shared section sits below the
            // module that owns the group: Payments belongs under Store, not
            // above it, and which of them is walked first is an accident of
            // the alphabet.
            const sections = [
                ...kept.filter((s) => !pooled.has(s) && !shared.has(s)),
                ...kept.filter((s) => shared.has(s)),
                ...kept.filter((s) => pooled.has(s)),
            ];
            // A header over the only section in a group names the group a
            // second time and distinguishes it from nothing. Gaming is four
            // one-page modules, so its whole contents sat under a lone
            // "EXTENSIONS" heading that carried no information at all.
            if (sections.length === 1 && pooled.has(sections[0])) {
                sections[0] = { ...sections[0], header: undefined, headerKey: undefined };
            }
            return { ...group, sections };
        })
        .filter((group) => group.sections.length > 0)
        .sort((a, b) => (sortOrder.get(a.id) ?? 0) - (sortOrder.get(b.id) ?? 0) || a.id.localeCompare(b.id));
}

/**
 * Every route the navigation can name, mapped to the label it shows for it.
 *
 * The breadcrumb used to titlecase the URL segment, which is why a module's
 * settings page read "Payments" under a sidebar that said "Ödeme Ayarları":
 * the segment is an English path, and a path is not a translation. Core items
 * carry a `labelKey`; module items were translated when the group was built.
 */
export function navLabels(
    groups: NavGroup[],
    translate: (key: string, fallback: string) => string,
): Map<string, string> {
    const labels = new Map<string, string>();
    for (const group of groups) {
        for (const section of group.sections) {
            for (const item of section.items) {
                labels.set(item.href, item.labelKey ? translate(item.labelKey, item.label) : item.label);
            }
        }
    }
    return labels;
}

/**
 * Finds which group a given pathname belongs to. Returns the group id
 * or null if no group matches.
 *
 * Matching strategy:
 *   1. Exact /admin → dashboard
 *   2. Longest-matching explicit `pathPrefix` across all groups
 *   3. Longest-matching item `href` across all groups (covers
 *      module-contributed entries that aren't in any pathPrefix)
 */

export function findActiveGroupId(pathname: string, groups: NavGroup[]): string | null {
    if (pathname === "/admin" || pathname === "/admin/") return "dashboard";

    let best: { id: string; length: number } | null = null;

    for (const group of groups) {
        // Explicit path prefixes
        const prefixes = Array.isArray(group.pathPrefix)
            ? group.pathPrefix
            : group.pathPrefix
                ? [group.pathPrefix]
                : [];
        for (const p of prefixes) {
            if (pathname === p || pathname.startsWith(p + "/")) {
                if (!best || p.length > best.length) {
                    best = { id: group.id, length: p.length };
                }
            }
        }

        // Item hrefs - covers module-contributed items and
        // items in groups that don't declare an explicit pathPrefix
        for (const section of group.sections) {
            for (const item of section.items) {
                if (pathname === item.href || pathname.startsWith(item.href + "/")) {
                    if (!best || item.href.length > best.length) {
                        best = { id: group.id, length: item.href.length };
                    }
                }
            }
        }
    }

    return best?.id ?? null;
}

/**
 * Build the "Theme" nav group for the currently-active theme. Returns null
 * when the active theme id is unknown (shouldn't happen, but defensive).
 * Called from the admin layout after resolving the active theme, then
 * passed as a prop to AdminSidebar.
 */
export function buildThemeNavGroup(activeThemeId: string): NavGroup | null {
    const manifest = themeRegistry[activeThemeId];
    if (!manifest) return null;

    const themeItems: ThemeAdminNavItem[] = themeAdminRoutes[activeThemeId] ?? [];

    const items: NavItem[] = [
        { label: "Appearance", href: "/admin/theme/appearance", icon: Palette },
        ...themeItems.map((i: ThemeAdminNavItem) => ({
            label: i.label,
            href: adminHref(i.path),
            icon: resolveLucideIcon(i.icon) ?? Palette,
        })),
    ];

    const manifestAny = manifest as { adminNav?: { label?: string; icon?: string } };
    const groupIcon = resolveLucideIcon(manifestAny.adminNav?.icon) ?? Palette;

    return {
        id: "theme",
        label: manifestAny.adminNav?.label ?? manifest.name,
        icon: groupIcon,
        pathPrefix: "/admin/theme",
        sections: [{ items }],
    };
}

/**
 * The icon a theme names in its manifest.
 *
 * This used to be `require("lucide-react")[name]`, which is `import *` wearing
 * a different syntax: the bundler cannot shake a lookup it cannot see, so all
 * 1,773 icon modules landed in the admin shell's chunk group. Measured on a
 * production build, 133 KB gzipped on each of 48 admin routes, for one icon on
 * one group in the rail.
 *
 * `NavIcon` fetches that one icon's chunk. Wrapped rather than rendered here
 * because the rail's contract is a component, and cached by name so React
 * sees the same type between renders - see `resolveIcon` in useAdminNav.ts,
 * which answers the same question for a module's menu.
 */
const themeIcons = new Map<string, ComponentType>();

function resolveLucideIcon(name: string | undefined): ComponentType | null {
    if (!name) return null;
    const cached = themeIcons.get(name);
    if (cached) return cached;
    const wrapper: ComponentType<{ className?: string; size?: number }> = ({ className, size }) =>
        createElement(NavIcon, { name, className, size });
    themeIcons.set(name, wrapper as ComponentType);
    return wrapper as ComponentType;
}
