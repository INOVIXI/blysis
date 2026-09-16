/**
 * Every public page this site serves, with the name and the description it
 * carries when nobody has said otherwise.
 *
 * The screen that manages SEO used to start empty: a table with an "Add page"
 * button and a free-text path field, so an operator had to already know that
 * `/store/product/[...params]` exists before they could describe it, and the
 * default it would be overriding was invisible. Meanwhile thirty-eight module
 * pages and nine of core's own had no description at all.
 *
 * A page is not core's to enumerate on its own - most of them belong to
 * modules - so this assembles the list from what each part already declared:
 * core's screens from `CORE_SCREENS`, a module's pages from the `routes` block
 * of its manifest. Core learns no module's name from its own source; it reads
 * the generated registry, and a module that is installed but switched off is
 * left out because its pages do not answer.
 *
 * The home page is the one entry with no declared keys. Its title and
 * description are the site's own, which is what it has always rendered.
 */

import { ModuleRoutes } from "@/core/generated/module-registry";
import { CORE_SCREENS } from "./core-screens";
import { getModuleStates } from "./module-cache";
import { getMessages } from "./i18n/translation-service";
import { getSeoSiteInfo } from "./seo";
import { descriptionFromMessages, moduleRouteTitle, titleFromMessages } from "./route-title";

export interface CataloguePage {
    /** Path below the locale segment. `/` is the home page. */
    path: string;
    /** What the page calls itself, in the language that was asked for. */
    title: string;
    /** What it says it is about, or "" where it says nothing. */
    description: string;
    /** `core`, or the id of the module that serves it. */
    owner: string;
    /** false where the page refuses crawlers by its own nature - a cart, a receipt. */
    indexable: boolean;
    /**
     * The path carries a dynamic segment, so it stands for many pages rather
     * than one. An override set against it applies to the pattern, and the
     * screen has to say so rather than let an operator think they are
     * describing a single product.
     */
    pattern: boolean;
}

export async function listCataloguePages(locale: string): Promise<CataloguePage[]> {
    const [messages, states, site] = await Promise.all([
        getMessages(locale).catch(() => null),
        getModuleStates().catch(() => ({}) as Record<string, boolean>),
        getSeoSiteInfo(),
    ]);

    const pages: CataloguePage[] = [
        {
            path: "/",
            title: site.siteName,
            description: site.siteDescription,
            owner: "core",
            indexable: true,
            pattern: false,
        },
    ];

    for (const screen of CORE_SCREENS) {
        pages.push({
            path: screen.path,
            title: titleFromMessages(messages, screen.titleKey) ?? moduleRouteTitle(undefined, screen.path, false),
            description: descriptionFromMessages(messages, screen.descriptionKey) ?? "",
            owner: "core",
            indexable: screen.index !== false,
            pattern: false,
        });
    }

    for (const route of ModuleRoutes) {
        if (route.isAdmin) continue;
        if (states[route.module] === false) continue;
        pages.push({
            path: route.path,
            title: titleFromMessages(messages, route.titleKey) ?? moduleRouteTitle(undefined, route.path, false),
            description: descriptionFromMessages(messages, route.descriptionKey) ?? "",
            owner: route.module,
            indexable: !route.noindex,
            pattern: route.path.includes("["),
        });
    }

    // The home page first, because it is the one every operator looks for, and
    // the rest alphabetically: a list ordered by whichever module happened to
    // be installed first is a list nobody can find anything in.
    return pages.sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.path.localeCompare(b.path)));
}
