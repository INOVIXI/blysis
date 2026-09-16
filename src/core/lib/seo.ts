/**
 * SEO helpers - shared across core pages and module pages.
 *
 * Provides:
 *   - buildPageMeta(): Next.js Metadata object with OpenGraph + Twitter cards
 *   - buildArticleJsonLd(): JSON-LD string for Article schema
 *   - buildOrganizationJsonLd(): JSON-LD string for Organization schema
 *
 * Site name + description are sourced from the Settings table with env/serverConfig
 * fallbacks so the helpers work for fresh installs with no DB rows yet.
 */

import { cache } from "react";
import type { Metadata } from "next";
import { prisma } from "./db";
import { resolveAppUrl } from "./app-url";
import { serverConfig } from "@/core/config/server";
import { localeAlternates, localizedPath } from "./sitemap-routes";
import { locales } from "./i18n/config";

export interface PageMetaInput {
    title: string;
    description?: string;
    image?: string;
    /** Path below the locale segment, e.g. `/store/cart`. */
    url?: string;
    /**
     * Which language this render is in. Every route on this site lives under a
     * locale segment, so a URL without one is a redirect rather than a page:
     * pass the locale and the canonical tag names the page a visitor is on
     * instead of the redirect that leads to it. Omit it and no canonical or
     * hreflang is emitted, which is better than emitting a wrong one.
     */
    locale?: string;
    type?: "website" | "article" | "profile";
    publishedTime?: string;
    authorName?: string;
}

export interface ArticleJsonLdInput {
    title: string;
    description?: string;
    image?: string;
    url: string;
    datePublished?: string;
    dateModified?: string;
    authorName?: string;
}

const SEO_SETTING_KEYS = ["site_name", "site_description"] as const;

export interface SeoSiteInfo {
    siteName: string;
    siteDescription: string;
    siteUrl: string;
}

/**
 * Reads site_name + site_description from Settings with env fallbacks.
 *
 * Cached for the length of one render, for the reason `getSession` and
 * `getActiveTheme` are: every route that declares metadata calls
 * `buildPageMeta`, so the root layout asks and the page inside it asks
 * again. Measured against a production build, that was two of the twelve
 * queries `/en/blog` issued for one request. A site cannot be renamed
 * between a layout's metadata and its page's.
 */
export const getSeoSiteInfo = cache(async function getSeoSiteInfo(): Promise<SeoSiteInfo> {
    // Runtime-resolved: see app-url.ts. Reading NEXT_PUBLIC_SITE_URL here
    // baked localhost into every canonical tag of every prebuilt-image install.
    const siteUrl = resolveAppUrl();

    let siteName: string = serverConfig.name;
    let siteDescription: string = serverConfig.description || "";

    try {
        const rows = await prisma.setting.findMany({
            where: { key: { in: [...SEO_SETTING_KEYS] } },
        });
        for (const r of rows) {
            const value = typeof r.value === "string" ? r.value : String(r.value ?? "");
            if (r.key === "site_name" && value) siteName = value;
            if (r.key === "site_description" && value) siteDescription = value;
        }
    } catch {
        // DB unavailable (build phase / fresh install) - fall back to defaults
    }

    return { siteName, siteDescription, siteUrl };
});

/** Synchronous version using only env/serverConfig - safe for non-async callers. */
function getSeoSiteInfoSync(): SeoSiteInfo {
    return {
        siteName: serverConfig.name,
        siteDescription: serverConfig.description || "",
        siteUrl: resolveAppUrl(),
    };
}

/**
 * `canonical` plus the `hreflang` set for one page.
 *
 * The sitemap has published these alternates for a while; the pages said
 * nothing, so a crawler comparing the two found the claim on one side only.
 * A path already carrying a locale segment is left alone - the caller has
 * given an absolute or already-localized URL and knows better than we do.
 */
function alternatesFor(siteUrl: string, path: string | undefined, locale: string | undefined) {
    if (!path || !locale || !(locales as readonly string[]).includes(locale)) return undefined;
    if (path.startsWith("http")) return undefined;
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return {
        canonical: `${siteUrl}${localizedPath(normalized, locale)}`,
        languages: localeAlternates(siteUrl, normalized),
    };
}

/**
 * The empty answer: nothing installed has an opinion about this page.
 *
 * Shared rather than rebuilt per call so a listener that returns the value it
 * was given costs nothing, which is the common case on a site whose operator
 * has set no overrides.
 */
const NO_PAGE_OVERRIDE: PageMetaOverride = {
    title: null,
    description: null,
    ogTitle: null,
    ogDescription: null,
    image: null,
    canonical: null,
    keywords: null,
    noIndex: false,
    noFollow: false,
};

/**
 * Ask whatever manages SEO whether it has been told something about this page.
 *
 * Core builds a head out of what the page itself declared - its title key, its
 * description key, the site's name - and an operator had no way to change any
 * of it without editing a module. Per-path overrides existed, in a module, and
 * that module could not rewrite `generateMetadata` for pages it does not own:
 * it patched `document.head` from the browser instead, so a crawler reading the
 * server's HTML never saw a word of it and the screen that set them was decor.
 *
 * Core names the question and never learns who answered. With no listener the
 * chain hands back the value it was given and nothing changes.
 */
async function pageOverride(input: PageMetaInput, built: { description: string }): Promise<PageMetaOverride> {
    const path = input.url;
    if (!path || path.startsWith("http")) return NO_PAGE_OVERRIDE;
    try {
        const { ensureHooks } = await import("./hooks-bootstrap");
        await ensureHooks();
        const { applyFiltersAsync } = await import("./hooks");
        return await applyFiltersAsync("seo.pageMeta", NO_PAGE_OVERRIDE, {
            path,
            locale: input.locale ?? "",
            title: input.title,
            description: built.description,
            image: input.image ?? null,
        });
    } catch {
        // A head is not worth a 500. Whatever failed - no database on a build
        // machine, a listener that threw - the page keeps the head core built.
        return NO_PAGE_OVERRIDE;
    }
}

/** The site's head with nothing said about it: what core works out on its own. */
const NO_SITE_HEAD: SiteHeadOverride = {
    defaultTitle: null,
    titleTemplate: null,
    keywords: null,
    googleVerification: null,
    bingVerification: null,
};

export interface SiteHead {
    /** The tab title for a page that names none of its own. */
    defaultTitle: string;
    /** How a page's name is framed, `%s` standing for the name. */
    titleTemplate: string;
    /** Comma-separated, or "" for no keywords tag. */
    keywords: string;
    googleVerification: string;
    bingVerification: string;
}

/**
 * The half of the head that belongs to the site rather than to a page.
 *
 * Only the root layout can set a title template, so only the root layout asks.
 * The defaults are what shipped before: the site's name, and the name after
 * the page's own. The site's name comes from the setting rather than from the
 * environment, which is why renaming a site used to change every heading on it
 * and leave the browser tab reading the old name.
 */
export async function buildSiteHead(): Promise<SiteHead> {
    const { siteName } = await getSeoSiteInfo();
    let answer = NO_SITE_HEAD;
    try {
        const { ensureHooks } = await import("./hooks-bootstrap");
        await ensureHooks();
        const { applyFiltersAsync } = await import("./hooks");
        answer = await applyFiltersAsync("seo.siteHead", NO_SITE_HEAD, { siteName });
    } catch {
        // Same rule as a page's head: it is not worth a 500.
    }

    const defaultTitle = answer.defaultTitle || siteName;
    return {
        defaultTitle,
        // `%s` is what Next expects, and a template without it would silently
        // put the same string in every tab on the site.
        titleTemplate: answer.titleTemplate?.includes("%s") ? answer.titleTemplate : `%s | ${defaultTitle}`,
        keywords: answer.keywords || "",
        googleVerification: answer.googleVerification || "",
        bingVerification: answer.bingVerification || "",
    };
}

/**
 * Build a Next.js Metadata object for a page, populated with OpenGraph and
 * Twitter card data. Use from `generateMetadata()` or as a static `metadata`
 * export. Async to allow reading Settings - await the result.
 */
export async function buildPageMeta(input: PageMetaInput): Promise<Metadata> {
    const { siteName, siteDescription, siteUrl } = await getSeoSiteInfo();
    const override = await pageOverride(input, { description: input.description || siteDescription });

    const title = override.title || input.title;
    const description = override.description || input.description || siteDescription;
    // A share card may be worded differently from a search result, and where
    // it is not it says the same thing rather than nothing.
    const cardTitle = override.ogTitle || title;
    const cardDescription = override.ogDescription || description;
    const image = override.image || input.image;
    const type = input.type || "website";
    const absoluteUrl = input.url
        ? input.url.startsWith("http") ? input.url : `${siteUrl}${input.url.startsWith("/") ? "" : "/"}${input.url}`
        : undefined;
    const absoluteImage = image
        ? image.startsWith("http") ? image : `${siteUrl}${image.startsWith("/") ? "" : "/"}${image}`
        : undefined;

    /*
     * The big card is for a page that brought its own artwork - an article's
     * cover, a product's photo. A page falling back to the site's own mark
     * gets the small one: `summary_large_image` stretches a square logo across
     * a 2:1 banner, which on every unfurl looked like a mistake.
     *
     * Decided on `input.image` rather than on the image that came out, because
     * only the page knows whether the picture is about the page.
     */
    const twitterCard: "summary" | "summary_large_image" = input.image ? "summary_large_image" : "summary";

    const computed = alternatesFor(siteUrl, input.url, input.locale);
    // An operator naming a canonical replaces the one core derived, but keeps
    // the `hreflang` set: the two answer different questions, and dropping the
    // alternates would unpublish a claim the sitemap still makes.
    const alternates = override.canonical
        ? { canonical: override.canonical, ...(computed?.languages ? { languages: computed.languages } : {}) }
        : computed;

    // Only ever a refusal. A caller that sets `robots` itself - a core screen
    // marked `index: false`, a module route marked `noindex` - spreads it over
    // what comes back from here, so core's own refusal still wins.
    const robots = override.noIndex || override.noFollow
        ? { index: !override.noIndex, follow: !override.noFollow }
        : undefined;

    return {
        title,
        description,
        ...(override.keywords ? { keywords: override.keywords } : {}),
        ...(alternates ? { alternates } : {}),
        ...(robots ? { robots } : {}),
        openGraph: {
            title: cardTitle,
            description: cardDescription,
            type,
            siteName,
            ...(absoluteUrl ? { url: absoluteUrl } : {}),
            ...(absoluteImage ? { images: [{ url: absoluteImage, alt: cardTitle }] } : {}),
            ...(type === "article" && input.publishedTime ? { publishedTime: input.publishedTime } : {}),
            ...(type === "article" && input.authorName ? { authors: [input.authorName] } : {}),
        },
        twitter: {
            card: twitterCard,
            title: cardTitle,
            description: cardDescription,
            ...(absoluteImage ? { images: [absoluteImage] } : {}),
        },
    };
}

/**
 * Build a JSON-LD Article schema string. Drop into a
 * <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ... }} />
 */
export function buildArticleJsonLd(input: ArticleJsonLdInput): string {
    const { siteName, siteUrl } = getSeoSiteInfoSync();
    const absoluteUrl = input.url.startsWith("http") ? input.url : `${siteUrl}${input.url.startsWith("/") ? "" : "/"}${input.url}`;
    const absoluteImage = input.image
        ? input.image.startsWith("http") ? input.image : `${siteUrl}${input.image.startsWith("/") ? "" : "/"}${input.image}`
        : undefined;

    const ld: Record<string, unknown> = {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: input.title,
        description: input.description,
        mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl },
        publisher: {
            "@type": "Organization",
            name: siteName,
            url: siteUrl,
        },
    };
    if (absoluteImage) ld.image = [absoluteImage];
    if (input.datePublished) ld.datePublished = input.datePublished;
    if (input.dateModified) ld.dateModified = input.dateModified;
    if (input.authorName) {
        ld.author = { "@type": "Person", name: input.authorName };
    }

    // Escape `<` so a value containing `</script>` cannot break out of the
    // surrounding <script type="application/ld+json"> tag.
    return JSON.stringify(ld).replace(/</g, "\\u003c");
}

/**
 * Build a JSON-LD Organization schema string for use in the root layout.
 */
export function buildOrganizationJsonLd(): string {
    const { siteName, siteDescription, siteUrl } = getSeoSiteInfoSync();
    const ld = {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: siteName,
        url: siteUrl,
        description: siteDescription,
    };
    // Escape `<` so a value containing `</script>` cannot break out of the
    // surrounding <script type="application/ld+json"> tag.
    return JSON.stringify(ld).replace(/</g, "\\u003c");
}
