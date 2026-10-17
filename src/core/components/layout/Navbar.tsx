"use client";

import { Link, usePathname } from "@/core/lib/i18n/navigation";
import { User, LogOut, Shield, Sun, Moon, ChevronDown } from "lucide-react";
import { NavIcon } from "@/core/components/ui/NavIcon";
import { buttonClassName } from "@/core/components/ui/button";
import { useTranslations } from "next-intl";
import { useSession, signOut } from "next-auth/react";
import { useState, useRef, useEffect } from "react";
import { useDarkMode } from "@/core/hooks/useDarkMode";
import { MemberAvatar } from "@/core/components/ui/MemberAvatar";
import { SiteMark, SiteName } from "@/core/components/ui/site-name";
import { useSiteSettings } from "@/core/hooks/useSiteSettings";
import { useAllModules } from "@/core/providers/module-provider";
import { ModuleNavLinks, ModuleRoutes, ModuleNavbarComponents } from "@/core/generated/module-registry";
import { NavbarComponentRegistry } from "@/core/generated/module-components";
import { ModuleErrorBoundary } from "@/core/components/ModuleErrorBoundary";
import { Slot } from "@/core/components/Slot";
import { MobileMenu } from "@/core/components/layout/MobileMenu";

// Re-exported from `navbar-links`, where the fold that uses it lives and the
// reason for the number is written down. Callers importing it from the bar
// were here first.
export { INLINE_NAV_LINKS } from "@/core/lib/navbar-links";

function DefaultNavbar() {
    const pathname = usePathname();
    const t = useTranslations('nav');
    const commonT = useTranslations('common');
    const { data: session } = useSession();
    const [menuOpen, setMenuOpen] = useState(false);
    const [navDropdown, setNavDropdown] = useState<string | null>(null);
    const { settings } = useSiteSettings();
    const moduleStatus = useAllModules();
    const [mounted, setMounted] = useState(false);
    const { isDark, toggle: toggleDarkMode } = useDarkMode();

     
    useEffect(() => { setMounted(true); }, []);

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

    const rawNavLinks = (Array.isArray(settings.navbar_links) ? settings.navbar_links : registryLinks) as { label: string; labelKey?: string; href: string; icon?: string; children?: { label: string; labelKey?: string; href: string }[] }[];

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
        .filter(Boolean) as typeof rawNavLinks;

    // A bar the admin arranged is drawn as arranged - they put the dropdowns
    // where they wanted them. The bar the site ships with grows by one link
    // per module installed, so it folds its own overflow. The fold is
    // `foldNavLinks`, which the navbar editor asks too: what an operator
    // opens has to be what the site is drawing, or the first save they make
    // replaces the fold with nine links inline.
    const shownLinks = adminConfigured ? navLinks : foldNavLinks(navLinks, t('more'));

    // The fold is by count, and a count knows nothing about the words: the
    // Turkish eight plus the fold are about 1000px, and the row wrapped below
    // 1536 into a bar whose height is fixed, so the second row hung below
    // the header and over the page. The nav is now one line tall and clips
    // what wraps, and whatever wrapped is gathered behind a trailing menu.
    //
    // This is measured, but nothing on the line moves for it. The server
    // draws the line with the wrapped entries already clipped away; after
    // mount the menu appears beside the line and the entries it took become
    // inert, so a keyboard cannot land on something nobody can see. An entry
    // vanishing and a trigger appearing are not shifts - nothing that was on
    // screen changes place.
    const navRef = useRef<HTMLElement>(null);
    const [overflowFrom, setOverflowFrom] = useState<number | null>(null);
    const shownKey = shownLinks.map((link) => link.label).join("\n");

    useEffect(() => {
        const nav = navRef.current;
        if (!nav) return;
        const measure = () => {
            const items = [...nav.querySelectorAll<HTMLElement>(":scope > [data-nav-item]")];
            const firstTop = items[0]?.offsetTop ?? 0;
            const at = items.findIndex((el) => el.offsetTop > firstTop);
            setOverflowFrom(at === -1 ? null : at);
        };
        measure();
        // Widths change when the webfont arrives, which resizes nothing.
        document.fonts?.ready.then(measure);
        if (typeof ResizeObserver === "undefined") return;
        // Showing the trailing menu narrows the nav, which is observed too,
        // and can only push more onto the second line - so this settles.
        const observer = new ResizeObserver(measure);
        observer.observe(nav);
        return () => observer.disconnect();
    }, [shownKey]);

    const overflowLinks = overflowFrom === null ? [] : shownLinks.slice(overflowFrom);

    const menuRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setNavDropdown(null);
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Navbar components from modules (bell, cart, etc.)
    const enabledNavbarComponents = ModuleNavbarComponents
        .filter(nc => isEnabledIn(moduleStatus, nc.module))
        .filter(nc => NavbarComponentRegistry[nc.id]);

    const isActive = (path: string) => path === "/" ? pathname === "/" : pathname.startsWith(path);
    const isStaffUser = (session?.user?.rolePriority ?? 0) >= STAFF_ROLE_PRIORITY;

    return (
        <>
        <header className="bg-card border-b border-[var(--color-border)] sticky top-0 z-50">
            <div className="container mx-auto px-4">
                {/* `relative` is what the nav's dropdowns hang from: the nav
                    clips its second line, and a panel positioned inside it
                    would be clipped with it. */}
                <div className="relative flex items-center justify-between h-12 gap-2">
                    {/* A phone gets the whole list through here, not the
                        eight that fit the bar: see MobileMenu. */}
                    <div className="sm:hidden flex items-center gap-1 min-w-0">
                        <MobileMenu links={navLinks} />
                        {/* The site's own mark, which the public bar did not
                            carry at all: it drew a house icon and the word
                            "home", so the only place an operator's logo
                            appeared was the admin rail. */}
                        <Link href="/" className="flex items-center gap-2 px-1 py-1.5 rounded-md text-sm font-semibold text-foreground hover:bg-muted transition-colors">
                            <SiteMark size={20} />
                            <span className="truncate"><SiteName /></span>
                        </Link>
                    </div>
                    {/* Outside the nav, because a brand is not a navigation
                        link: it belongs to the page, and counting it among the
                        links is what made the bar think it had one more than
                        it does. */}
                    <Link
                        href="/"
                        className="hidden sm:flex items-center gap-2 px-1 py-1.5 mr-1 rounded-md text-sm font-semibold text-foreground hover:bg-muted transition-colors shrink-0"
                    >
                        <SiteMark size={22} />
                        <span className="truncate max-w-[10rem]"><SiteName /></span>
                    </Link>
                    {/* One line tall: `py-1` leaves room for a focus ring,
                        and `gap-y-2` starts a wrapped line past the bottom
                        edge, where `overflow-hidden` takes all of it. */}
                    <nav ref={navRef} className="hidden sm:flex flex-wrap content-start items-center gap-x-1 gap-y-2 h-10 py-1 min-w-0 flex-1 overflow-hidden" aria-label={t('primary')}>
                        <Slot name="navbar.start" />
                        {shownLinks.map((link, index) => {
                            const clipped = overflowFrom !== null && index >= overflowFrom;
                            // Dropdown menu
                            if (link.children && link.children.length > 0) {
                                return (
                                    // Not `relative`: the panel takes its
                                    // horizontal place from here and its top
                                    // from the bar, outside the clip.
                                    <div key={link.label} data-nav-item inert={clipped}
                                        onMouseEnter={() => setNavDropdown(link.label)}
                                        onMouseLeave={() => setNavDropdown(null)}
                                    >
                                        <button
                                            type="button"
                                            aria-haspopup="menu"
                                            aria-expanded={navDropdown === link.label}
                                            onClick={() => setNavDropdown(navDropdown === link.label ? null : link.label)}
                                            onKeyDown={(e) => {
                                                // Hover was the only way in, so the trigger took
                                                // focus and did nothing: every folded link was
                                                // unreachable without a mouse.
                                                if (e.key === "Enter" || e.key === " ") {
                                                    e.preventDefault();
                                                    setNavDropdown(navDropdown === link.label ? null : link.label);
                                                } else if (e.key === "Escape") {
                                                    setNavDropdown(null);
                                                }
                                            }}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${navDropdown === link.label ? "text-primary bg-muted" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                                        >
                                            <NavIcon name={link.icon} className="w-4 h-4" />
                                            {link.label}
                                            <ChevronDown className={`w-3 h-3 transition-transform ${navDropdown === link.label ? "rotate-180" : ""}`} />
                                        </button>
                                        {navDropdown === link.label && (
                                            <div className="absolute top-full pt-1 z-50">
                                                <div className="w-52 bg-card border border-[var(--color-border)] rounded-lg shadow-lg py-1 animate-fade-in">
                                                    {link.children.map((child: { label: string; href: string; icon?: string }) => (
                                                        <Link key={child.href} href={child.href}
                                                            onClick={() => setNavDropdown(null)}
                                                            className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                                                            <NavIcon name={child.icon} className="w-4 h-4 text-muted-foreground" />
                                                            {child.label}
                                                        </Link>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            }

                            // Normal link
                            return (
                                <Link key={link.href} href={link.href} data-nav-item inert={clipped}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${isActive(link.href) ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
                                    <NavIcon name={link.icon} className="w-4 h-4" />
                                    {link.label}
                                </Link>
                            );
                        })}
                    </nav>

                    {/* What the line could not hold. When the fold itself is
                        among it, its links are listed here flat rather than
                        as a menu inside a menu. */}
                    {overflowLinks.length > 0 && (
                        <div data-nav-item className="hidden sm:block relative shrink-0"
                            onMouseEnter={() => setNavDropdown(OVERFLOW_MENU)}
                            onMouseLeave={() => setNavDropdown(null)}
                        >
                            <button
                                type="button"
                                aria-haspopup="menu"
                                aria-expanded={navDropdown === OVERFLOW_MENU}
                                onClick={() => setNavDropdown(navDropdown === OVERFLOW_MENU ? null : OVERFLOW_MENU)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        setNavDropdown(navDropdown === OVERFLOW_MENU ? null : OVERFLOW_MENU);
                                    } else if (e.key === "Escape") {
                                        setNavDropdown(null);
                                    }
                                }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${navDropdown === OVERFLOW_MENU ? "text-primary bg-muted" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                            >
                                <NavIcon name="MoreHorizontal" className="w-4 h-4" />
                                {t('more')}
                                <ChevronDown className={`w-3 h-3 transition-transform ${navDropdown === OVERFLOW_MENU ? "rotate-180" : ""}`} />
                            </button>
                            {navDropdown === OVERFLOW_MENU && (
                                <div className="absolute top-full right-0 pt-1 z-50">
                                    <div className="w-56 max-h-[70vh] overflow-y-auto bg-card border border-[var(--color-border)] rounded-lg shadow-lg py-1 animate-fade-in">
                                        {overflowLinks.flatMap((link) => link.children && link.children.length > 0 ? link.children : [link]).map((link) => (
                                            <Link key={link.href} href={link.href}
                                                onClick={() => setNavDropdown(null)}
                                                className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                                                <NavIcon name={(link as { icon?: string }).icon} className="w-4 h-4 text-muted-foreground" />
                                                {link.label}
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        {/* The button holds its place before the theme is
                            known. Rendering nothing until `mounted` left a
                            gap that filled after paint and pushed this whole
                            row sideways, which is a layout shift for the sake
                            of one icon. Only the icon waits now.

                            It is not disabled while it waits. `disabled` is
                            an attribute, so marking it made the served HTML
                            differ from what the same component asks for once
                            it has mounted, and React reported the pair as a
                            hydration mismatch it would not patch up. It was
                            buying nothing either way: a button that has not
                            hydrated has no handler to run. */}
                        <button onClick={toggleDarkMode}
                            aria-label={isDark ? t('switchToLight') : t('switchToDark')}
                            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                            {mounted
                                ? (isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />)
                                : <span className="block w-4 h-4" aria-hidden="true" />}
                        </button>

                        {session?.user ? (
                            <>
                                {/* Module navbar components (bell, cart, etc.) - from registry */}
                                {enabledNavbarComponents.map(nc => {
                                    const NavComp = NavbarComponentRegistry[nc.id];
                                    return (
                                        <ModuleErrorBoundary key={nc.id} componentId={nc.id}>
                                            <NavComp />
                                        </ModuleErrorBoundary>
                                    );
                                })}

                                <Slot name="navbar.end" />

                                <div className="relative" ref={menuRef}>
                                    <button
                                        type="button"
                                        onClick={() => setMenuOpen(!menuOpen)}
                                        aria-label={t('profileMenu')}
                                        aria-haspopup="menu"
                                        aria-expanded={menuOpen}
                                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted transition-colors">
                                        <MemberAvatar name={session.user.name || "?"} src={session.user.image} size={28} />
                                        <span className="text-sm font-medium text-foreground hidden sm:block">{session.user.name}</span>
                                    </button>

                                    {menuOpen && (
                                        <div className="absolute right-0 top-full mt-1 w-48 bg-card rounded-lg shadow-lg border border-border py-1 z-50 animate-fade-in">
                                            <div className="px-3 py-2 border-b border-border">
                                                <p className="text-sm font-medium text-foreground truncate">{session.user.name}</p>
                                                <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
                                            </div>
                                            <Link href="/profile" className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setMenuOpen(false)}>
                                                <User className="w-4 h-4" /> {t('profile')}
                                            </Link>
                                            {isStaffUser && (
                                                <Link href="/admin" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setMenuOpen(false)}>
                                                    <Shield className="w-4 h-4" /> {t('adminPanel')}
                                                </Link>
                                            )}
                                            <div className="border-t border-border">
                                                <button onClick={() => signOut({ callbackUrl: "/" })} className="flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 w-full text-left">
                                                    <LogOut className="w-4 h-4" /> {commonT('logout')}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="flex items-center gap-2">
                                <Link href="/auth/login" className={buttonClassName("ghost", "sm", "text-muted-foreground")}>{commonT('login')}</Link>
                                <Link href="/auth/register" className={buttonClassName("default", "sm")}>{commonT('register')}</Link>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </header>
        </>
    );
}

import { ThemeComponentSlot } from "@/core/components/theme/ThemeComponentSlot";
import { isEnabledIn } from "@/core/lib/module-enabled";
import { foldNavLinks } from "@/core/lib/navbar-links";
import { STAFF_ROLE_PRIORITY } from "@/core/lib/constants";

/** Dropdown key for the trailing menu, kept out of the space of link labels. */
const OVERFLOW_MENU = "__overflow__";

export function Navbar() {
    return <ThemeComponentSlot name="Navbar" fallback={DefaultNavbar} />;
}
