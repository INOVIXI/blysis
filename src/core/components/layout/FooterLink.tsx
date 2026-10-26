"use client";

import { NavIcon } from "@/core/components/ui/NavIcon";
import { Link } from "@/core/lib/i18n/navigation";
import type { FooterColumnLink } from "@/core/lib/footer-columns";

/**
 * One link of a footer column, with its icon. A page of the site goes through
 * the locale-aware `Link`, so it stays in the reader's language; an address
 * elsewhere opens in a new tab and says nothing about the site to it.
 */
export function FooterLink({ link, className }: { link: FooterColumnLink; className?: string }) {
    const inside = (
        <>
            <NavIcon name={link.icon} className="w-4 h-4 shrink-0" />
            {link.label}
        </>
    );
    if (link.external) {
        return (
            <a href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
                {inside}
            </a>
        );
    }
    return <Link href={link.href} className={className}>{inside}</Link>;
}
