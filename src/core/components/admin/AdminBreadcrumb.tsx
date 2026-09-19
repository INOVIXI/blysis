"use client";

import { Link, usePathname } from "@/core/lib/i18n/navigation";
import { Home, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { navLabels } from "@/core/lib/admin-nav-groups";
import { useAdminNav, type AdminNavModule } from "@/core/hooks/useAdminNav";

/**
 * Small breadcrumb rendered in the admin top bar.
 *
 * A crumb names a route, and the sidebar already knows what every route is
 * called - in the reader's language, including the ones a module contributed.
 * So the label comes from the navigation first. `crumb_<slug>` covers the
 * routes that have no sidebar entry of their own (a detail page, a form), and
 * titlecasing the URL segment is the last resort, which is what the whole
 * thing used to do: on /admin/settings/payments it read "Ayarlar > Payments",
 * because an English path is not a translation.
 */
/**
 * Whether a segment is a record's key rather than a place.
 *
 * The trail is built from the address and its last resort is to titlecase a
 * segment it has no name for, which is right for `payments` and absurd for a
 * cuid: every admin screen that edits one record showed the reader
 * "Tickets > Cmu34gnnk00j5v2titt9zcr61", twenty-five characters of database
 * key, capitalised, sitting in the site's chrome as though it were a section
 * of the panel.
 *
 * It is dropped rather than named. This component is built from the URL and
 * knows nothing about the record; the page's own heading says which ticket
 * this is three lines below, and a trail that stops at "Tickets" is true and
 * is where Back goes.
 *
 * By shape, not by length. A cuid is a `c` and twenty-four more; a uuid has
 * its dashes; anything else long enough to be one and made only of hex is one
 * too. A slug somebody chose - `email-queue`, `rate-limits` - has letters a
 * random key does not put together, and a number is a page or an entry
 * number, which is a place.
 */
function isRecordId(segment: string): boolean {
    if (/^c[a-z0-9]{20,}$/i.test(segment)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return true;
    return /^[0-9a-f]{24,}$/i.test(segment);
}

export function AdminBreadcrumb({
    modules = [],
    activeThemeId,
}: {
    modules?: AdminNavModule[];
    activeThemeId?: string;
}) {
    const pathname = usePathname();
    const t = useTranslations("admin");
    const groups = useAdminNav(modules, activeThemeId);
    const labels = navLabels(groups, (key, fallback) => (t.has(key) ? t(key) : fallback));

    // Strip /admin prefix and split
    const raw = pathname.replace(/^\/+/, "");
    const parts = raw.split("/").filter(Boolean);
    // parts[0] is "admin" - drop it
    const crumbs = parts.slice(1).filter((seg) => !isRecordId(seg));

    const titleize = (slug: string, href: string) => {
        const named = labels.get(href);
        if (named) return named;
        const key = `crumb_${slug}`;
        if (t.has(key)) return t(key);
        return slug
            .replace(/-/g, " ")
            .replace(/\[.*?\]/g, "")
            .replace(/\b\w/g, (c) => c.toUpperCase())
            .trim();
    };

    return (
        <nav
            aria-label={t("crumb_landmark")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
            <Link
                href="/admin"
                className="p-1 rounded hover:bg-muted hover:text-foreground transition"
                aria-label={t("crumb_home")}
            >
                <Home size={14} />
            </Link>
            {crumbs.map((seg, i) => {
                const isLast = i === crumbs.length - 1;
                const href = "/admin/" + crumbs.slice(0, i + 1).join("/");
                return (
                    <span key={href} className="flex items-center gap-1.5">
                        <ChevronRight size={12} className="opacity-50" />
                        {isLast ? (
                            <span className="text-foreground font-medium">{titleize(seg, href)}</span>
                        ) : (
                            <Link href={href} className="hover:text-foreground transition">
                                {titleize(seg, href)}
                            </Link>
                        )}
                    </span>
                );
            })}
            {crumbs.length === 0 && (
                <>
                    <ChevronRight size={12} className="opacity-50" />
                    <span className="text-foreground font-medium">
                        {t("crumb_overview")}
                    </span>
                </>
            )}
        </nav>
    );
}
