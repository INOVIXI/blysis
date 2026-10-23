"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Footer, Slot } from "@/core/sdk/layout";
import { Link, usePathname } from "@/core/sdk/navigation";
import { NavIcon } from "@/core/sdk/ui";
import { NavbarActions, SiteMark, SiteName, useNavLinks, type NavLink, type SiteShellProps } from "@/core/sdk/theme";
import Hero from "./Hero";

function RailLink({ link, active }: { link: NavLink; active: boolean }) {
    return (
        <Link href={link.href} aria-current={active ? "page" : undefined} className="vg-rail-link" data-active={active || undefined}>
            <NavIcon name={link.icon} className="w-[18px] h-[18px] shrink-0" />
            <span className="truncate">{link.label}</span>
        </Link>
    );
}

/**
 * A group the admin made in the navbar editor. Drawn open when one of its
 * pages is the one being read, so the reader can see where they are.
 */
function RailGroup({ link, isActive }: { link: NavLink; isActive: (href: string) => boolean }) {
    const children = link.children ?? [];
    const holdsCurrent = children.some((child) => isActive(child.href));
    const [open, setOpen] = useState(holdsCurrent);
    return (
        <div>
            <button type="button" className="vg-rail-link w-full" aria-expanded={open} onClick={() => setOpen(!open)}>
                <NavIcon name={link.icon} className="w-[18px] h-[18px] shrink-0" />
                <span className="truncate flex-1 text-left">{link.label}</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {open && (
                <div className="vg-rail-sub">
                    {children.map((child) => (
                        <RailLink key={child.href} link={child} active={isActive(child.href)} />
                    ))}
                </div>
            )}
        </div>
    );
}

/**
 * Vanguard's frame: the site's mark, its navigation and the account controls
 * down the left edge, the page beside them, the footer under both.
 *
 * The links are the ones the site's bar would draw, from `useNavLinks`, so an
 * operator's navbar editor arranges this rail too. On the homepage the hero
 * opens the page column and the homepage widgets stand beside it; the grid
 * that does that is in `theme.css` under `.vg-home`.
 */
export default function SiteShell({ children }: SiteShellProps) {
    const t = useTranslations("nav");
    const pathname = usePathname();
    const { links, isActive } = useNavLinks();
    const home = pathname === "/";

    return (
        <div className="vg-site min-h-screen flex flex-col bg-background">
            <div className="vg-frame flex-1">
                <aside className="vg-rail">
                    <Link href="/" className="vg-brand">
                        <SiteMark size={44} className="vg-brand-mark" />
                        <SiteName className="vg-brand-name" />
                    </Link>
                    <nav aria-label={t("primary")} className="vg-rail-nav">
                        <Slot name="navbar.start" />
                        {links.map((link) =>
                            link.children && link.children.length > 0 ? (
                                <RailGroup key={link.label} link={link} isActive={isActive} />
                            ) : (
                                <RailLink key={link.href} link={link} active={isActive(link.href)} />
                            ),
                        )}
                    </nav>
                    <div className="vg-rail-actions">
                        <NavbarActions />
                    </div>
                </aside>

                <main className="vg-main">
                    {home ? (
                        <div className="vg-home">
                            <Hero />
                            {children}
                        </div>
                    ) : (
                        children
                    )}
                </main>
            </div>
            <Footer />
        </div>
    );
}
