import type { MetadataRoute } from "next";
import { getModuleStates } from "@/core/lib/module-cache";
import { ModuleSeoRoutes, type SitemapEntry } from "@/core/generated/module-seo";
import { safeCall } from "@/core/lib/module-safe-call";
import { connection } from "next/server";
import { resolveAppUrl } from "@/core/lib/app-url";
import { getSiteLanguages } from "@/core/lib/i18n/site-languages-setting";
import { ModuleRoutes } from "@/core/generated/module-registry";
import {
    CORE_STATIC_ROUTES,
    localeAlternates,
    localizedPaths,
    staticModuleRoutes,
} from "@/core/lib/sitemap-routes";

// This used to be `export const revalidate = 3600`, which made Next prerender
// the sitemap at BUILD time and serve that copy for the first hour. In a
// prebuilt image that meant every URL in it read `http://localhost:3001` - the
// value CI had while building. `connection()` in the handler below opts the
// route out of build-time prerendering; this in-process memo restores exactly
// what `revalidate` was protecting: bots hitting /sitemap.xml still do not
// force a DB query per request.
const SITEMAP_TTL_MS = 3_600_000;
let sitemapMemo: { at: number; siteUrl: string; languages: string; entries: MetadataRoute.Sitemap } | null = null;

function mapChangeFreq(freq: SitemapEntry["changeFreq"]): MetadataRoute.Sitemap[number]["changeFrequency"] {
    return freq;
}

/**
 * Dynamic sitemap: merges core static routes with every installed+enabled
 * module's SEO contributor. Each module loader is wrapped in try/catch so
 * one broken module cannot break the whole sitemap.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    await connection();

    // Runtime-resolved from AUTH_URL - a NEXT_PUBLIC_* read here would be
    // frozen at build time and emit localhost URLs from the prebuilt image.
    const siteUrl = resolveAppUrl();
    // Only the languages the site offers: a page in another is a redirect.
    const site = await getSiteLanguages();
    const languages = `${site.offered.join(",")}:${site.preferred}`;

    // Keyed on siteUrl as well as age: an operator who changes AUTH_URL and
    // restarts must not be served an hour of stale, wrong-host URLs.
    if (
        sitemapMemo &&
        sitemapMemo.siteUrl === siteUrl &&
        sitemapMemo.languages === languages &&
        Date.now() - sitemapMemo.at < SITEMAP_TTL_MS
    ) {
        return sitemapMemo.entries;
    }
    // Every page on this site lives under a locale segment, so a bare path is a
    // 307 and never a canonical URL. Each path is published once per locale,
    // and each of those entries carries the `hreflang` alternates that tell a
    // crawler the others are the same page in another language.
    //
    // No `lastModified`: core does not know when a module's page last changed,
    // and a sitemap that stamps every URL with the generation time teaches a
    // crawler to ignore the field. A module's own contributor supplies a real
    // one below.
    const entries: MetadataRoute.Sitemap = CORE_STATIC_ROUTES.flatMap((r) =>
        localizedPaths(r.path, site).map((path) => ({
            url: `${siteUrl}${path}`,
            changeFrequency: r.changeFrequency,
            priority: r.priority,
            alternates: { languages: localeAlternates(siteUrl, r.path, site) },
        })),
    );

    // Only modules that are actually enabled contribute URLs. Keeps the
    // sitemap aligned with what's actually routable on the site.
    let enabledStates: Record<string, boolean> = {};
    try {
        enabledStates = await getModuleStates();
    } catch {
        enabledStates = {};
    }

    // Every static page an enabled module routes. A module's own contributor
    // below can still add detail URLs core cannot enumerate, and a duplicate
    // there simply overwrites this entry's defaults.
    for (const routePath of staticModuleRoutes(ModuleRoutes, enabledStates)) {
        for (const path of localizedPaths(routePath, site)) {
            entries.push({
                url: `${siteUrl}${path}`,
                changeFrequency: "weekly",
                priority: 0.7,
                alternates: { languages: localeAlternates(siteUrl, routePath, site) },
            });
        }
    }

    for (const seoRoute of ModuleSeoRoutes) {
        if (!enabledStates[seoRoute.module]) continue;

        // Wrap each loader + handler in the sandbox so a broken module
        // can't break the sitemap for the whole site. Runtime errors get
        // logged to ActivityLog for admin visibility.
        const moduleEntries = await safeCall<SitemapEntry[]>(
            seoRoute.module,
            "seo.sitemap",
            async () => {
                const mod = await seoRoute.loader();
                const handler = mod.default;
                if (typeof handler !== "function") return [];
                const result = await handler();
                return Array.isArray(result) ? result : [];
            },
            [],
        );

        for (const e of moduleEntries) {
            const shared = {
                ...(e.lastModified ? { lastModified: e.lastModified } : {}),
                ...(e.changeFreq ? { changeFrequency: mapChangeFreq(e.changeFreq) } : {}),
                ...(typeof e.priority === "number" ? { priority: e.priority } : {}),
            };

            // A module names a path, never a locale: it has no way to know
            // which ones this install serves. An absolute URL is the module
            // pointing somewhere it owns, so it is published as written.
            if (e.url.startsWith("http")) {
                entries.push({ url: e.url, ...shared });
                continue;
            }

            const routePath = e.url.startsWith("/") ? e.url : `/${e.url}`;
            for (const path of localizedPaths(routePath, site)) {
                entries.push({
                    url: `${siteUrl}${path}`,
                    ...shared,
                    alternates: { languages: localeAlternates(siteUrl, routePath, site) },
                });
            }
        }
    }

    // A module that lists a page core already published would otherwise appear
    // twice; the module's own entry wins, since it carries the real lastmod.
    const deduped = [...new Map(entries.map((e) => [e.url, e])).values()];

    sitemapMemo = { at: Date.now(), siteUrl, languages, entries: deduped };
    return deduped;
}
