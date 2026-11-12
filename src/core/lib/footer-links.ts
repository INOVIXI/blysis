/**
 * Admin-authored footer links.
 *
 * `footer_quick_links` and `footer_legal_links` are free-form JSON settings.
 * They are the reason core no longer hardcodes a legal column: which pages an
 * install considers "legal" is a per-site decision, not something core can
 * know. The footer editor has moved past them to `footer_columns`, where the
 * headings are the operator's too, but they still hold the live footer of
 * every install that has not opened that screen and are read as columns
 * rather than migrated.
 *
 * The value is admin-supplied and rendered as an anchor, so every href is
 * checked here rather than at the render site. `footer-columns.ts` builds on
 * that check rather than repeating it.
 *
 * A label may be written per language (`translatable-text.ts`). It is read in
 * the language the caller names, and in the original where that language has
 * nothing; `labelText` keeps every language for the editor.
 */

import { cleanTranslatableText, isTranslatableText, originalText, textFor, type TranslatableText } from "@/core/lib/i18n/translatable-text";

export interface FooterLink {
    /** In the language the footer was read in. */
    label: string;
    /**
     * Every language the operator wrote it in, for their editor. Absent while
     * the label is one string, which `label` already is.
     */
    labelText?: TranslatableText;
    href: string;
    /** True for absolute http(s) links, which render as a plain anchor. */
    external: boolean;
}

const MAX_LINKS = 20;
const MAX_LABEL = 64;

/**
 * Internal paths only, or absolute http(s). Everything else - `javascript:`,
 * `data:`, `mailto:`, and protocol-relative `//host` - is dropped.
 */
function classifyHref(href: string): { href: string; external: boolean } | null {
    if (href.startsWith("//")) return null;
    if (href.startsWith("/")) return { href, external: false };

    let url: URL;
    try {
        url = new URL(href);
    } catch {
        return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { href, external: true };
}

export function parseFooterLinks(raw: unknown, locale = ""): FooterLink[] {
    let value = raw;

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            value = JSON.parse(trimmed);
        } catch {
            return [];
        }
    }

    if (!Array.isArray(value)) return [];

    const links: FooterLink[] = [];
    for (const entry of value) {
        if (links.length >= MAX_LINKS) break;
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;

        const { label, href } = entry as { label?: unknown; href?: unknown };
        if (!isTranslatableText(label) || typeof href !== "string") continue;

        // A link with no original is one the operator half-wrote, whatever
        // its translations say: the original is what every other reader sees.
        const classified = classifyHref(href.trim());
        if (!originalText(label).trim() || !classified) continue;

        links.push({
            label: textFor(label, locale).trim().slice(0, MAX_LABEL),
            ...(typeof label === "string" ? {} : { labelText: cleanTranslatableText(label, MAX_LABEL) }),
            href: classified.href,
            external: classified.external,
        });
    }

    return links;
}
