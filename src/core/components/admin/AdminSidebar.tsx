"use client";

import { useState, useEffect } from "react";
import { useModalDialog } from "@/core/hooks/useModalDialog";
import { Link, usePathname, useRouter } from "@/core/lib/i18n/navigation";
import { useTranslations } from "next-intl";
import { useDarkMode } from "@/core/hooks/useDarkMode";
import { Menu, X, Sun, Moon } from "lucide-react";
import {
    findActiveGroupId,
    type NavGroup,
    type NavItem,
    type NavSection,
} from "@/core/lib/admin-nav-groups";
import { type AdminNavReader, useAdminNav, type AdminNavModule } from "@/core/hooks/useAdminNav";
import { SiteMark, SiteName } from "@/core/components/ui/site-name";

interface AdminSidebarProps {
    userName?: string;
    userEmail?: string;
    modules?: AdminNavModule[];
    /**
     * Active theme id - used to build the dynamic "Theme" nav group on the
     * client. Passing the id (a string) rather than the full NavGroup keeps
     * us on the serializable side of the RSC boundary; the built group
     * contains icon ComponentTypes (from lucide-react) which Next rejects
     * when passed as a prop.
     */
    activeThemeId?: string;
    /** Draw only what this person may open. See `useAdminNav`. */
    reader?: AdminNavReader;
}

/**
 * Two-level admin sidebar.
 *
 *   [ icon rail ] [ contextual sidebar ]
 *       w-14            w-56
 *
 * Icon rail: one icon per top-level group. Only groups that actually have
 * items appear, so a zero-module install shows no dead entries. Clicking an
 * icon selects that group.
 *
 * Contextual sidebar: shows the items in the currently-selected group,
 * broken into sections with small uppercase headers. Module `menu[]`
 * contributions are merged in by `buildNavGroups`.
 *
 * Mobile: both rails collapse into a single overlay sheet.
 */
export function AdminSidebar({ modules = [], activeThemeId, reader }: AdminSidebarProps) {
    const pathname = usePathname();
    const router = useRouter();
    const [mobileOpen, setMobileOpen] = useState(false);

    // The drawer draws a scrim over the page and closes when it is clicked, so
    // it owes a keyboard user the same exit every dialog here owes: Escape, a
    // Tab that stays inside, and focus back on the button that opened it.
    const drawerRef = useModalDialog<HTMLElement>(mobileOpen, () => setMobileOpen(false));
    const { isDark, toggle: toggleDarkMode } = useDarkMode();
    const t = useTranslations("admin");

    // The breadcrumb builds the same groups from the same hook, so the two
    // never disagree about what a route is called.
    const groups: NavGroup[] = useAdminNav(modules, activeThemeId, reader);

    // Selection state machine:
    //   - `pathDerivedId` is the group the current URL resolves to
    //   - `userSelection` is an explicit icon click that may diverge
    //     from the URL (e.g. clicking Commerce while still on Dashboard
    //     to browse an empty group before picking a module item)
    //   - On pathname change we clear `userSelection` so the URL-derived
    //     group takes over naturally after any Link navigation
    const pathDerivedId = findActiveGroupId(pathname, groups) || "dashboard";
    const [userSelection, setUserSelection] = useState<string | null>(null);

    useEffect(() => {
        setUserSelection(null);
    }, [pathname]);

    // The selected group can disappear underneath us - a module disabled in
    // another tab drops its group from the merge. Fall back to the dashboard
    // rather than rendering an empty shell.
    const effectiveGroupId = userSelection || pathDerivedId;
    const activeGroup =
        groups.find((g) => g.id === effectiveGroupId) ??
        groups.find((g) => g.id === "dashboard") ??
        groups[0];

    const handleGroupClick = (group: NavGroup) => {
        setUserSelection(group.id);
        setMobileOpen(false);
        // Every group has at least one item, so selecting one always has
        // somewhere to go. Navigate to the first item unless we are already
        // inside the group, so the main content updates with the rail.
        const firstItem = group.sections.find((s) => s.items.length > 0)?.items[0];
        if (firstItem && pathDerivedId !== group.id) {
            router.push(firstItem.href);
        }
    };

    const isActive = (href: string) => {
        if (href === "/admin") return pathname === "/admin" || pathname === "/admin/";
        // Collect all item hrefs in the current group so we can use
        // longest-prefix matching. This prevents "/admin/settings" from
        // lighting up when "/admin/settings/general" is the real match.
        const allHrefs = activeGroup.sections.flatMap((s) => s.items.map((i) => i.href));
        const matchesHref = pathname === href || pathname.startsWith(href + "/");
        if (!matchesHref) return false;
        // If another item in the same group is a longer (more specific) match, this one loses.
        for (const other of allHrefs) {
            if (other === href) continue;
            if (other.length > href.length && (pathname === other || pathname.startsWith(other + "/"))) {
                return false;
            }
        }
        return true;
    };

    const labelOf = (item: NavItem): string => {
        if (item.labelKey && t.has(item.labelKey)) return t(item.labelKey);
        return item.label;
    };

    const sectionHeaderOf = (section: NavSection): string | undefined => {
        if (section.headerKey && t.has(section.headerKey)) return t(section.headerKey);
        return section.header;
    };

    const groupLabelOf = (group: NavGroup): string => {
        if (group.labelKey && t.has(group.labelKey)) return t(group.labelKey);
        return group.label;
    };

    // ─── Icon rail ───
    const iconRail = (
        <div className="flex flex-col h-full py-3 items-center gap-1">
            <div className="relative group/rail mb-2">
                <Link
                    href="/admin"
                    onClick={() => setMobileOpen(false)}
                    className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 transition"
                    aria-label={t("sidebar_adminHome")}
                >
                    {/* A logo, never letters.
                     *
                     * This drew the site's initials until somebody set a logo,
                     * so an installation that had not opened the settings
                     * screen wore two letters in the corner of every admin
                     * page - which reads as a placeholder nobody chose, and is
                     * one. The fallback is the icon the installation already
                     * ships and that a browser already shows in the tab, so
                     * the corner is a mark either way and an operator changes
                     * it in one place.
                     *
                     * A plain `img`: the address is whatever they uploaded or
                     * linked, and which storage provider answered is not
                     * core's business. */}
                    <SiteMark size={28} />
                </Link>
                <span
                    role="tooltip"
                    className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 rounded-md bg-foreground text-background text-xs font-medium whitespace-nowrap shadow-lg opacity-0 group-hover/rail:opacity-100 transition-opacity duration-150 z-50"
                >
                    <SiteName />
                </span>
            </div>
            {groups.map((group) => {
                const Icon = group.icon;
                const isSelected = effectiveGroupId === group.id;
                const label = groupLabelOf(group);
                return (
                    <div key={group.id} className="relative group/rail">
                        <button
                            type="button"
                            onClick={() => handleGroupClick(group)}
                            aria-label={label}
                            aria-current={isSelected ? "page" : undefined}
                            className={`w-10 h-10 rounded-lg flex items-center justify-center transition relative ${
                                isSelected
                                    ? "bg-primary/15 text-primary"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            }`}
                        >
                            <Icon size={18} />
                            {isSelected && (
                                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r" />
                            )}
                        </button>
                        {/* CSS tooltip - appears to the right on hover */}
                        <span
                            role="tooltip"
                            className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 rounded-md bg-foreground text-background text-xs font-medium whitespace-nowrap shadow-lg opacity-0 group-hover/rail:opacity-100 transition-opacity duration-150 z-50"
                        >
                            {label}
                        </span>
                    </div>
                );
            })}

            <div className="mt-auto flex flex-col items-center gap-1">
                <div className="relative group/rail">
                    <button
                        type="button"
                        onClick={toggleDarkMode}
                        aria-label={isDark ? t("sidebar_lightMode") : t("sidebar_darkMode")}
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition"
                    >
                        {isDark ? <Sun size={18} /> : <Moon size={18} />}
                    </button>
                    <span
                        role="tooltip"
                        className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 rounded-md bg-foreground text-background text-xs font-medium whitespace-nowrap shadow-lg opacity-0 group-hover/rail:opacity-100 transition-opacity duration-150 z-50"
                    >
                        {isDark ? t("sidebar_lightMode") : t("sidebar_darkMode")}
                    </span>
                </div>
            </div>
        </div>
    );

    // ─── Contextual sidebar ───
    const contextSidebar = (
        <div className="flex flex-col h-full py-4 px-3 overflow-y-auto">
            <div className="px-2 mb-4">
                <h2 className="text-sm font-semibold text-foreground">{groupLabelOf(activeGroup)}</h2>
            </div>

            <nav className="flex-1 space-y-4" aria-label={groupLabelOf(activeGroup)}>
                {activeGroup.sections.map((section, sIdx) => (
                    <div key={`${activeGroup.id}-${sIdx}`}>
                        {section.header && (
                            <div className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                                {sectionHeaderOf(section)}
                            </div>
                        )}
                        <ul className="space-y-0.5">
                            {section.items.map((item) => {
                                const Icon = item.icon;
                                const active = isActive(item.href);
                                return (
                                    <li key={item.href}>
                                        <Link
                                            href={item.href}
                                            onClick={() => setMobileOpen(false)}
                                            className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition ${
                                                active
                                                    ? "bg-primary/10 text-primary font-medium"
                                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                                            }`}
                                        >
                                            {Icon && <Icon size={15} className={active ? "text-primary" : ""} />}
                                            <span className="truncate flex-1">{labelOf(item)}</span>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </nav>
        </div>
    );

    return (
        <>
            {/* Mobile hamburger */}
            <button
                onClick={() => setMobileOpen(true)}
                aria-label={t("sidebar_openMenu")}
                className="lg:hidden fixed top-4 left-4 z-50 w-10 h-10 rounded-lg bg-card border border-border shadow-sm flex items-center justify-center"
            >
                <Menu size={20} />
            </button>

            {/* Mobile overlay */}
            {mobileOpen && (
                <div
                    className="lg:hidden fixed inset-0 bg-black/50 z-40"
                    onClick={() => setMobileOpen(false)}
                    aria-hidden="true"
                />
            )}

            {/* Mobile sidebar: stacks icon rail above contextual items */}
            <aside
                ref={drawerRef}
                role="dialog"
                aria-modal="true"
                aria-label={t("sidebar_landmark")}
                // Closed, it is still `display: flex` below `lg` and only moved
                // out of view by a transform, which leaves it in the tab order.
                inert={!mobileOpen}
                className={`lg:hidden fixed top-0 left-0 bottom-0 flex z-50 transition-transform duration-200 bg-card border-r border-border ${
                    mobileOpen ? "translate-x-0" : "-translate-x-full"
                }`}
            >
                <div className="w-14 border-r border-border bg-background/50">{iconRail}</div>
                <div className="w-56 relative">
                    <button
                        onClick={() => setMobileOpen(false)}
                        aria-label={t("sidebar_closeMenu")}
                        className="absolute top-4 right-4 w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center z-10"
                    >
                        <X size={18} />
                    </button>
                    {contextSidebar}
                </div>
            </aside>

            {/* Desktop: fixed icon rail + contextual sidebar */}
            <aside
                aria-label={t("sidebar_landmark")}
                className="hidden lg:flex fixed top-0 left-0 bottom-0 bg-card border-r border-border z-30"
            >
                <div className="w-14 border-r border-border bg-background/30">{iconRail}</div>
                <div className="w-56">{contextSidebar}</div>
            </aside>
        </>
    );
}
