/**
 * The footer, as columns an operator names.
 *
 * Core used to render two fixed columns and fill them from two free-form JSON
 * settings, which made "which pages this site considers legal" editable and
 * left everything else - a support column, a community column, a column of
 * partner sites - impossible without touching core. A column is now data: a
 * title, an optional icon per link, and the module section it adopts.
 *
 * That last part is the load-bearing one. A module contributes footer links
 * and declares the section they belong to, in its own words, and core cannot
 * know the list. An early version of the old filter kept `section === "quick"`
 * and swallowed every other one. So placement here never drops: a link whose
 * section no column claims joins the catch-all, and when there are no columns
 * at all one is made for it.
 *
 * The old settings keys are read rather than migrated, so an install that
 * never opens the new screen keeps the footer it has and nothing has to run.
 */

import { parseFooterLinks, type FooterLink } from "@/core/lib/footer-links";

/**
 * Who put a link in a column.
 *
 * The composed footer holds three kinds at once and a reader of it cannot
 * otherwise tell them apart. The editor needs to: what a module contributes
 * is drawn where it will land but is not the operator's to edit, and saving
 * it would freeze a module's own name into the operator's own footer.
 */
export type FooterLinkSource = "operator" | "module" | "home";

/** A link in a column. `icon` is a Lucide name; a bad one renders nothing. */
export interface FooterColumnLink extends FooterLink {
    icon: string | null;
    source: FooterLinkSource;
}

export interface FooterColumn {
    /** The operator's own words, or null for a column core seeded. */
    title: string | null;
    /** A key into the `footer` catalogue, for a column core seeded. */
    titleKey: string | null;
    /** Module links declaring this section join this column. */
    section: string | null;
    links: FooterColumnLink[];
}

/** Wide enough for any footer worth reading, narrow enough to stay a footer. */
const MAX_COLUMNS = 6;
const MAX_TITLE = 48;
const MAX_ICON = 48;

/** The section the legacy legal column claimed, and still claims. */
const LEGAL_SECTION = "legal";

function text(value: unknown, limit: number): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed.slice(0, limit);
}

/**
 * `parseFooterLinks` already decides which addresses a browser may follow, so
 * the icon is the only thing added here. It is carried alongside rather than
 * validated: `NavIcon` renders nothing for a name Lucide does not know, which
 * turns a typo into a missing icon instead of a missing link.
 */
function columnLinks(raw: unknown): FooterColumnLink[] {
    const links = parseFooterLinks(raw);
    const icons = new Map<string, string | null>();
    if (Array.isArray(raw)) {
        for (const entry of raw) {
            if (!entry || typeof entry !== "object") continue;
            const { href, icon } = entry as { href?: unknown; icon?: unknown };
            if (typeof href === "string") icons.set(href.trim(), text(icon, MAX_ICON));
        }
    }
    return links.map((link) => ({ ...link, icon: icons.get(link.href) ?? null, source: "operator" as const }));
}

/**
 * Null when nothing was ever saved, which is what tells a caller to fall back
 * to the legacy settings. An empty array is a footer an operator emptied on
 * purpose and is not the same answer.
 */
export function parseFooterColumns(raw: unknown): FooterColumn[] | null {
    let value = raw;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") return null;
        try {
            value = JSON.parse(trimmed);
        } catch {
            return null;
        }
    }
    if (!Array.isArray(value)) return null;

    const columns: FooterColumn[] = [];
    for (const entry of value) {
        if (columns.length >= MAX_COLUMNS) break;
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const { title, titleKey, section, links } = entry as Record<string, unknown>;

        const heading = text(title, MAX_TITLE);
        const key = text(titleKey, MAX_TITLE);
        // A column with no heading is a list of links with nothing to say what
        // they have in common, which is a column an operator half-created.
        if (!heading && !key) continue;

        columns.push({
            title: heading,
            titleKey: heading ? null : key,
            section: text(section, MAX_TITLE),
            links: columnLinks(links),
        });
    }
    return columns;
}

/**
 * The two columns core rendered before this screen existed, read straight out
 * of the settings that still hold them.
 */
export function legacyColumns(quick: unknown, legal: unknown): FooterColumn[] {
    return [
        { title: null, titleKey: "quickLinks", section: null, links: columnLinks(quick) },
        { title: null, titleKey: "legal", section: LEGAL_SECTION, links: columnLinks(legal) },
    ];
}

export interface ModuleFooterLink {
    /** The module's own English name for it, and only ever the fallback. */
    label: string;
    /** Where that name lives in the `nav` catalogue, where one was declared. */
    labelKey?: string | null;
    href: string;
    section?: string | null;
    icon?: string | null;
}

/**
 * The words the composition needs, which live in the reader's catalogues
 * rather than here.
 */
export interface FooterWords {
    /** What the way home is called. */
    home: string;
    /** A module link's name in the reader's language, or null for none. */
    moduleLink: (key: string) => string | null;
}

/**
 * The footer, composed: the operator's columns, what the installed modules
 * put in them, and the way home.
 *
 * Both the site and the editor ask this. They used not to - the editor read
 * the saved columns and stopped there - so an install that had never saved a
 * footer opened the screen to two empty columns while its own site was
 * drawing nine links, and the section box, which is what decides where a
 * module's links land, had nothing to show for being typed in.
 */
export function drawnFooterColumns(
    columns: FooterColumn[],
    moduleLinks: readonly ModuleFooterLink[],
    words: FooterWords,
): FooterColumn[] {
    const named = moduleLinks.map((link) => ({
        ...link,
        label: (link.labelKey ? words.moduleLink(link.labelKey) : null) ?? link.label,
    }));
    return withHomeLink(placeModuleLinks(columns, named), words.home);
}

/**
 * Every module link lands in exactly one column, after the operator's own.
 *
 * The catch-all is the first column claiming no section; failing that, the
 * first column; failing that, one made here. A link is never dropped for
 * naming a section nobody adopted, because the module chose that word and
 * core has no say in it.
 */
export function placeModuleLinks(
    columns: FooterColumn[],
    moduleLinks: ModuleFooterLink[],
): FooterColumn[] {
    const placed: FooterColumn[] = columns.map((column) => ({ ...column, links: [...column.links] }));
    if (moduleLinks.length === 0) return placed;

    if (placed.length === 0) {
        placed.push({ title: null, titleKey: "quickLinks", section: null, links: [] });
    }
    const catchAll = placed.find((column) => column.section === null) ?? placed[0];

    for (const link of moduleLinks) {
        const section = text(link.section, MAX_TITLE);
        const home = section === null
            ? catchAll
            : placed.find((column) => column.section === section) ?? catchAll;
        home.links.push({
            label: link.label,
            href: link.href,
            external: false,
            icon: text(link.icon, MAX_ICON),
            source: "module",
        });
    }
    return placed;
}

/**
 * The way home, in the catch-all column.
 *
 * Core used to render this link at the top of a column it also owned, so it
 * could not be lost. With columns an operator writes, a footer emptied down
 * to nothing would leave a reader on a deep page with no way back to the
 * front - so one column is made when there are none, and the link is skipped
 * when a column already points at `/`.
 */
export function withHomeLink(columns: FooterColumn[], label: string): FooterColumn[] {
    const base: FooterColumn[] = columns.length > 0
        ? columns.map((column) => ({ ...column, links: [...column.links] }))
        : [{ title: null, titleKey: "quickLinks", section: null, links: [] }];

    if (base.some((column) => column.links.some((link) => link.href === "/"))) return base;

    const home = base.find((column) => column.section === null) ?? base[0];
    home.links.unshift({ label, href: "/", external: false, icon: null, source: "home" });
    return base;
}
