import { locales, defaultLocale, type Locale } from "@/core/lib/i18n/config";

/**
 * What the sitemap and robots.txt agree to publish.
 *
 * Both files used to keep their own list, and they disagreed: the sitemap
 * submitted `/auth/login` and `/auth/register` while robots.txt disallowed
 * `/auth`, which is the shape Search Console reports as "indexed, though
 * blocked". They share the lists here instead.
 *
 * The other half of the problem was what the sitemap left out. Core ships no
 * pages of its own beyond the home and activity screens: on this platform the
 * content is the modules, and a module only reached the sitemap by declaring a
 * `seo` contributor, which none of the first-party ones do. Every static page
 * an enabled module routes is published now; a contributor is still how a
 * module adds the URLs core cannot know, like one per product.
 *
 * The third problem was the locale. Every route in this product lives under a
 * locale segment - `localePrefix: "always"` - so `/store` is not a page, it is
 * a 307 to `/en/store`. The sitemap published the bare paths, which made every
 * URL in it a redirect, and robots.txt disallowed bare `/admin`, `/auth` and
 * `/profile`, which are prefixes no crawlable URL on this site begins with. It
 * blocked nothing. Both are built from `localizedPaths` now.
 */

/** Path prefixes robots.txt tells crawlers to skip. */
export const DISALLOWED_PREFIXES = ["/admin", "/api", "/auth", "/profile"] as const;

export interface CoreStaticRoute {
    path: string;
    changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
    priority: number;
}

/** Pages core routes itself, with no module involved. */
export const CORE_STATIC_ROUTES: CoreStaticRoute[] = [
    { path: "/", changeFrequency: "daily", priority: 1.0 },
    { path: "/activity", changeFrequency: "daily", priority: 0.6 },
];

/**
 * The same path under every locale the site serves, in `locales` order.
 *
 * The home page is `/en`, not `/en/`: a trailing slash would be a second URL
 * for the same page and Next redirects it away.
 */
export function localizedPaths(path: string): string[] {
    return locales.map((locale) => localizedPath(path, locale));
}

export function localizedPath(path: string, locale: Locale | string): string {
    return path === "/" ? `/${locale}` : `/${locale}${path}`;
}

/**
 * `hreflang` alternates for one path: every locale, plus the `x-default` that
 * tells a crawler which one to show a visitor whose language matches none.
 */
export function localeAlternates(siteUrl: string, path: string): Record<string, string> {
    const languages: Record<string, string> = {};
    for (const locale of locales) languages[locale] = `${siteUrl}${localizedPath(path, locale)}`;
    languages["x-default"] = `${siteUrl}${localizedPath(path, defaultLocale)}`;
    return languages;
}

/**
 * What robots.txt actually writes: each disallowed prefix under every locale,
 * plus the bare prefix. `/api` is the one route group with no locale segment,
 * and the bare forms still matter because they are what a crawler is redirected
 * from.
 */
export function disallowedPaths(): string[] {
    const out = new Set<string>();
    for (const prefix of DISALLOWED_PREFIXES) {
        out.add(prefix);
        if (prefix === "/api") continue;
        for (const locale of locales) out.add(`/${locale}${prefix}`);
    }
    return [...out];
}

export function isCrawlable(path: string): boolean {
    return !DISALLOWED_PREFIXES.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
}

export interface RouteLike {
    path: string;
    module: string;
    isAdmin?: boolean;
    /** The module asked for this page to stay out of search results. */
    noindex?: boolean;
}

/**
 * Static public pages contributed by enabled modules.
 *
 * A path with a dynamic segment is skipped: core knows the pattern
 * (`/u/[username]`) and not the values, so listing it would submit a URL
 * that 404s. Those belong to the module's own `seo` contributor.
 */
export function staticModuleRoutes(
    routes: readonly RouteLike[],
    enabled: Record<string, boolean>,
): string[] {
    const paths = new Set<string>();
    for (const route of routes) {
        if (route.isAdmin) continue;
        if (route.noindex) continue;
        if (enabled[route.module] !== true) continue;
        if (!route.path.startsWith("/")) continue;
        if (route.path.includes("[")) continue;
        if (!isCrawlable(route.path)) continue;
        paths.add(route.path);
    }
    return [...paths].sort();
}
