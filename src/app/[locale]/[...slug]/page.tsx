
import { cache } from "react";
import { ensureHooks } from "@/core/lib/hooks-bootstrap";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModuleRegistry } from "@/core/generated/module-page-registry";
import { ModuleRoutes } from "@/core/generated/module-registry";
import { ModuleRouteResolvers } from "@/core/generated/module-route-resolvers";
import { matchModuleRouteOnce } from "@/core/lib/route-matcher";
import { buildPageMeta } from "@/core/lib/seo";
import { resolveRouteTitle, descriptionFromMessages } from "@/core/lib/route-title";
import { getMessages } from "@/core/lib/i18n/translation-service";

/**
 * Ask the module whether the URL names anything, when it declared a way to ask.
 *
 * A page that looks its subject up in the browser has already answered 200 by
 * the time it finds nothing, so `/u/nobody` was a soft 404: indexable,
 * and invisible to a link checker or a monitor watching for a status. A route
 * with a `resolver` in its manifest gets the question asked here instead,
 * before anything renders.
 *
 * `cache` keeps it to one call per request even though metadata and the page
 * both ask, and a resolver that throws is treated as "no opinion" rather than
 * turning a database hiccup into a 404 on a page that exists.
 */
const routeExists = cache(async (key: string, params: Record<string, string | string[]>): Promise<boolean> => {
    const load = ModuleRouteResolvers[key];
    if (!load) return true;
    try {
        const { default: resolve } = await load();
        return await resolve(params);
    } catch (err) {
        console.error(`[route-resolver] ${key} failed`, err);
        return true;
    }
});

// export const dynamic = "force-dynamic"; // Removed to support ISR
export const revalidate = 60;

interface PageProps {
    params: Promise<{
        slug: string[];
        locale: string;
    }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Title a module-rendered page. The name comes from the route the module
 * declared, not from the URL the visitor typed, unless that route declared
 * `titleFromPath` - see `moduleRouteTitle`. Modules with richer per-page SEO
 * needs render <script type="application/ld+json"> inline so search engines
 * still get full data.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { slug, locale } = await params;
    const match = matchModuleRouteOnce(slug.join("/"));
    const route = match ? ModuleRoutes.find((r) => r.key === match.key) : undefined;

    // Only for a route that declared a name or a description; the fallbacks
    // need no catalogue.
    const declared = Boolean(route?.titleKey || route?.descriptionKey);
    const messages = declared ? await getMessages(locale).catch(() => null) : null;

    // Without one, every module page shipped the single site-wide sentence as
    // its meta description and its og:description, so a search result for the
    // store, the forum and the leaderboard said exactly the same thing.
    const description = descriptionFromMessages(messages, route?.descriptionKey);

    const meta = await buildPageMeta({
        title: resolveRouteTitle({
            slug,
            routePattern: route?.path,
            titleFromPath: route?.titleFromPath,
            titleKey: route?.titleKey,
            messages,
        }),
        ...(description ? { description } : {}),
        url: "/" + (slug?.join("/") || ""),
        locale,
        // What the route said it is, and `website` for everything that said
        // nothing. This was `article` for every module page on the site.
        type: route?.ogType ?? "website",
    });

    // Nothing serves this path, or the registry no longer carries the route it
    // matched: the component below is about to call `notFound()`. Next renders
    // the not-found page with its own metadata, so this is belt and braces for
    // anything that reads the head before then.
    if (!match) {
        return { ...meta, robots: { index: false, follow: false } };
    }
    if (!route) {
        return { ...meta, robots: { index: false, follow: false } };
    }

    // The route pattern matches but names nothing. Same treatment: the page is
    // about to 404, and until it does, no crawler should be told to index this.
    if (!(await routeExists(match.key, match.params))) {
        return { ...meta, robots: { index: false, follow: false } };
    }

    // A module can mark a route `noindex` in its manifest: a cart, an order
    // confirmation, anything whose content belongs to one visitor. The same
    // flag keeps the page out of the sitemap.
    if (route.noindex) {
        return { ...meta, robots: { index: false, follow: true } };
    }
    return meta;
}

export default async function DynamicModulePage(props: PageProps) {
    // Every module page is rendered through here, so the bus is filled once
    // for all of them. `instrumentation.ts` bootstraps a different module
    // graph: without this a page asks a question no listener answers, and
    // gets its own input back with no error to show for it.
    await ensureHooks();
    const { params } = props;
    const { slug } = await params;

    const match = matchModuleRouteOnce(slug.join("/"));

    if (!match) {
        notFound();
    }

    const Component = ModuleRegistry[match.key];

    if (!Component) {
        console.error(`Module component not found in registry: ${match.key}`);
        notFound();
    }

    if (!(await routeExists(match.key, match.params))) {
        notFound();
    }

    // Pass params and searchParams to the module page
    // Using a type assertion because we know we are passing valid props
    return <Component {...props} params={Promise.resolve({ ...await params, ...match.params })} />;
}
