"use client";

import { Link } from "@/core/lib/i18n/navigation";
import { ChevronDown } from "lucide-react";
import { NavIcon } from "@/core/components/ui/NavIcon";
import { useTranslations } from "next-intl";
import { useState, useRef, useEffect, type CSSProperties } from "react";
import { SiteMark, SiteName } from "@/core/components/ui/site-name";
import { useNavLinks } from "@/core/hooks/useNavLinks";
import { Slot } from "@/core/components/Slot";
import { MobileMenu } from "@/core/components/layout/MobileMenu";
import { NavbarActions } from "@/core/components/layout/NavbarActions";

// Re-exported from `navbar-links`, where the fold that uses it lives and the
// reason for the number is written down. Callers importing it from the bar
// were here first.
export { INLINE_NAV_LINKS } from "@/core/lib/navbar-links";

/**
 * Where a bar's menu hangs: its transparent top starts on the trigger's
 * bottom edge, a pixel or two up so no rounding parts them, and its card
 * starts just under the bar.
 *
 * The bar's menus hang from the bar rather than their trigger, because the
 * nav clips what it holds, and a strip between the trigger and the panel
 * belonged to neither: crossing it left the item and shut the menu before
 * the pointer reached a link. A fixed reach of three quarters of a rem
 * closed the strip on core's 48px bar and left 6px of it on a theme's 68px
 * one, so the reach is measured from where the trigger is.
 * `tests/e2e/a-menu-stays-open-on-the-way-into-it.spec.ts`.
 */
function hangBelow(trigger: HTMLElement, bar: HTMLElement | null): CSSProperties | undefined {
    if (!bar) return undefined;
    const box = bar.getBoundingClientRect();
    const top = trigger.getBoundingClientRect().bottom - box.top - bar.clientTop - 2;
    return { top, paddingTop: Math.max(0, bar.clientHeight - top) + 4 };
}

function DefaultNavbar() {
    const t = useTranslations('nav');
    const [navDropdown, setNavDropdown] = useState<string | null>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const [hang, setHang] = useState<CSSProperties>();
    const openMenu = (label: string, trigger: HTMLElement) => {
        setHang(hangBelow(trigger, barRef.current));
        setNavDropdown(label);
    };

    const { links: navLinks, arranged: adminConfigured, isActive } = useNavLinks();

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
    const overflowEntries = overflowLinks.flatMap((link) => (link.children && link.children.length > 0 ? link.children : [link]));


    return (
        <>
        <header className="bg-card border-b border-[var(--color-border)] sticky top-0 z-50">
            <div className="container mx-auto px-4">
                {/* `relative` is what the nav's dropdowns hang from: the nav
                    clips its second line, and a panel positioned inside it
                    would be clipped with it. */}
                <div ref={barRef} className="relative flex items-center justify-between h-12 gap-2">
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
                                        onMouseEnter={(e) => openMenu(link.label, e.currentTarget.querySelector("button") ?? e.currentTarget)}
                                        onMouseLeave={() => setNavDropdown(null)}
                                    >
                                        <button
                                            type="button"
                                            aria-haspopup="menu"
                                            aria-expanded={navDropdown === link.label}
                                            onClick={(e) => (navDropdown === link.label ? setNavDropdown(null) : openMenu(link.label, e.currentTarget))}
                                            onKeyDown={(e) => {
                                                // Hover was the only way in, so the trigger took
                                                // focus and did nothing: every folded link was
                                                // unreachable without a mouse.
                                                if (e.key === "Enter" || e.key === " ") {
                                                    e.preventDefault();
                                                    if (navDropdown === link.label) setNavDropdown(null);
                                                    else openMenu(link.label, e.currentTarget);
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
                                            // `hangBelow` says where.
                                            <div className="absolute top-full pt-1 z-50" style={hang}>
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
                                    {/* One column holds about eight entries before the list runs past a
                                        laptop's window and the last ones need a scroll nobody thinks to
                                        try. A narrow bar folds most of the site in here, so a long list
                                        takes two columns and stays whole on the screen. */}
                                    <div className={`${overflowEntries.length > 8 ? "w-[28rem] grid grid-cols-2" : "w-56"} max-h-[70vh] overflow-y-auto bg-card border border-[var(--color-border)] rounded-lg shadow-lg py-1 animate-fade-in`}>
                                        {overflowEntries.map((link) => (
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

                    <NavbarActions />
                </div>
            </div>
        </header>
        </>
    );
}

import { ThemeComponentSlot } from "@/core/components/theme/ThemeComponentSlot";
import { foldNavLinks } from "@/core/lib/navbar-links";

/** Dropdown key for the trailing menu, kept out of the space of link labels. */
const OVERFLOW_MENU = "__overflow__";

export function Navbar() {
    return <ThemeComponentSlot name="Navbar" fallback={DefaultNavbar} />;
}
