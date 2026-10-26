import { defaultLocale, locales, type Locale } from "./config";

/**
 * The languages a site offers its visitors, and the one it opens in.
 *
 * The software ships every language in `locales`; the operator decides which
 * the site speaks (`site_languages`) and which it opens in (`default_locale`,
 * the key the setup wizard has always written and nothing used to read). Read
 * tolerantly: whatever the column holds, a site offers at least one language
 * and opens in one it offers. `a-site-speaks-the-languages-it-offers` holds it.
 *
 * Kept free of anything server-only, because the footer's language picker
 * asks the same question in the browser.
 */
export interface SiteLanguages {
    /** In the order the software lists them. */
    offered: Locale[];
    /** What a visitor is given when nothing says otherwise. */
    preferred: Locale;
}

function isLocale(value: unknown): value is Locale {
    return typeof value === "string" && (locales as readonly string[]).includes(value);
}

function listOf(raw: unknown): unknown[] {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== "string") return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function siteLanguagesOf(offered: unknown, preferred: unknown): SiteLanguages {
    const chosen = listOf(offered).filter(isLocale);
    const list = chosen.length > 0 ? locales.filter((l) => chosen.includes(l)) : [...locales];
    const opens = isLocale(preferred) && list.includes(preferred)
        ? preferred
        : list.includes(defaultLocale) ? defaultLocale : list[0];
    return { offered: list, preferred: opens };
}

/** What the request says about the visitor's language. */
export interface LanguageAsk {
    /** The language they chose on this site before (`NEXT_LOCALE`). */
    cookie?: string | null;
    acceptLanguage?: string | null;
}

/** The language a visitor who arrived without one is given. */
export function languageFor(site: SiteLanguages, ask: LanguageAsk): Locale {
    const offered = (value: string): Locale | null =>
        site.offered.find((l) => l === value) ?? null;
    if (ask.cookie) {
        const chosen = offered(ask.cookie);
        if (chosen) return chosen;
    }
    for (const part of (ask.acceptLanguage ?? "").split(",")) {
        const tag = part.split(";")[0].trim().toLowerCase();
        const hit = offered(tag) ?? offered(tag.split("-")[0]);
        if (hit) return hit;
    }
    return site.preferred;
}

/**
 * Where a page request belongs, or null when it is already there: a path
 * with no language goes to the visitor's, one in a language the site does
 * not offer to the same page in the site's. The panel is left in whatever
 * language its reader chose, since the operator choosing for their visitors
 * has not chosen for themselves.
 */
export function languageRedirect(pathname: string, site: SiteLanguages, ask: LanguageAsk): string | null {
    const match = pathname.match(/^\/([a-z]{2})(\/.*)?$/);
    const prefix = match?.[1];
    if (isLocale(prefix)) {
        const rest = match?.[2] ?? "";
        if (rest === "/admin" || rest.startsWith("/admin/")) return null;
        if (site.offered.includes(prefix)) return null;
        return `/${site.preferred}${rest}`;
    }
    const language = languageFor(site, ask);
    return pathname === "/" ? `/${language}` : `/${language}${pathname}`;
}
