"use client";

import type { ReactNode } from "react";
import { SiteMark } from "@/core/components/ui/site-name";
import { useTranslations } from "next-intl";
import { Globe, Mail, Users } from "lucide-react";
import { FooterDropdown } from "@/core/components/ui/footer-dropdown";
import { FooterColumn } from "@/core/components/layout/FooterColumn";
import { FooterCredit } from "@/core/components/layout/FooterCredit";
import { FooterLink } from "@/core/components/layout/FooterLink";
import { FooterModuleControls } from "@/core/components/layout/FooterModuleControls";
import { Slot } from "@/core/components/Slot";
import { ThemeComponentSlot } from "@/core/components/theme/ThemeComponentSlot";
import { useFooter, type FooterSocialLink } from "@/core/hooks/useFooter";
import { useLanguageChoice } from "@/core/hooks/useLanguageChoice";

const FOOTER_LINK_CLASS = "text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-2";

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

const SOCIAL_CLASS = "w-8 h-8 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors text-xs font-bold";

/** What a theme's own footer is handed. */
export interface FooterProps {
    /** Where modules draw into the top of the footer; draw it inside yours. */
    top: ReactNode;
}

function SocialMark({ link, communityLabel }: { link: FooterSocialLink; communityLabel: string }) {
    if (link.name === "community") {
        return (
            <a href={link.href} target="_blank" rel="noopener noreferrer" aria-label={communityLabel} className={`${SOCIAL_CLASS} hover:bg-primary`}>
                <Users className="w-4 h-4" aria-hidden="true" />
            </a>
        );
    }
    const marks = { facebook: ["Facebook", "f"], instagram: ["Instagram", "ig"], x: ["X", "X"], youtube: ["YouTube", "yt"] } as const;
    const [label, mark] = marks[link.name];
    return (
        <a href={link.href} target="_blank" rel="noopener noreferrer" aria-label={label} className={SOCIAL_CLASS}>
            <span aria-hidden="true">{mark}</span>
        </a>
    );
}

function DefaultFooter({ top }: FooterProps) {
    const t = useTranslations("footer");
    const commonT = useTranslations("common");
    const navT = useTranslations("nav");
    const footer = useFooter();
    const language = useLanguageChoice();

    // Brand, the operator's columns, and settings. An empty column would
    // leave a hole in the grid rather than a narrower one, so `useFooter`
    // drops it and the grid narrows to match. The classes are written out
    // because Tailwind reads this file as text: an interpolated
    // `grid-cols-${n}` is a class it never generates and the grid silently
    // collapses to one column.
    const columnClass = GRID_COLUMNS[Math.min(footer.columns.length + 2, GRID_COLUMNS.length - 1)];

    return (
        <footer className="bg-card text-card-foreground border-t border-border mt-12">
            {top}
            <div className="container mx-auto px-4 py-12">
                <div className={`grid ${columnClass} gap-8`}>
                    {/* Brand */}
                    <div>
                        {/* The mark beside the name, the same one the bar and
                            the admin rail draw. A footer that spelled the name
                            and nothing else was the third place an operator's
                            logo did not appear. */}
                        <div className="flex items-center gap-3 mb-4">
                            <SiteMark size={28} />
                            <span className="text-foreground font-bold text-lg">{footer.siteName}</span>
                        </div>
                        {footer.about && (
                            <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                                {footer.about}
                            </p>
                        )}
                        <ul className="flex gap-3 list-none p-0" aria-label={navT("social")}>
                            {footer.social.map((link) => (
                                <li key={link.name}><SocialMark link={link} communityLabel={navT("community")} /></li>
                            ))}
                        </ul>
                    </div>

                    {/* The operator's columns, plus whatever modules contributed
                        to each. Core names no page and no section of its own. */}
                    {footer.columns.map((column, index) => (
                        <FooterColumn key={`${column.title}-${index}`} title={column.title}>
                            <ul className="space-y-2 text-sm">
                                {column.links.map((fl) => (
                                    <li key={fl.href}><FooterLink link={fl} className={FOOTER_LINK_CLASS} /></li>
                                ))}
                            </ul>
                        </FooterColumn>
                    ))}

                    {/* Settings */}
                    <FooterColumn title={commonT("settings")}>
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Globe className="w-4 h-4 text-muted-foreground" />
                                <FooterDropdown
                                    options={language.options.map((o) => o.value)}
                                    value={language.locale}
                                    onChange={language.choose}
                                    formatLabel={(l) => language.options.find((o) => o.value === l)?.label ?? l}
                                />
                            </div>
                            <FooterModuleControls />
                        </div>

                        {footer.email && (
                            <div className="mt-6">
                                <p className="text-muted-foreground text-sm flex items-center gap-2">
                                    <Mail className="w-4 h-4" />
                                    {footer.email}
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
                            {footer.copyright
                                ?? `© ${new Date().getFullYear()} ${footer.siteName}. ${t("allRightsReserved")}`}
                        </p>
                        <FooterCredit />
                    </div>
                </div>
            </div>
        </footer>
    );
}

/**
 * The site's footer: the active theme's when it draws one, core's otherwise.
 * Either is handed the slot modules draw into the top of it, and the slot
 * under the whole page follows it, so no module's contribution depends on
 * which footer is drawn. `a-theme-draws-the-footer-from-the-site-s-own-parts`
 * holds both.
 */
export function Footer() {
    return (
        <>
            <ThemeComponentSlot name="Footer" fallback={DefaultFooter} top={<Slot name="footer.top" />} />
            <Slot name="layout.bottom" />
        </>
    );
}
