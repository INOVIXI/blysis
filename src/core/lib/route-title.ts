
/**
 * The `<title>` core gives a page it renders on a module's behalf.
 *
 * A module page is a component in a registry, not a route segment file, so it
 * cannot export `generateMetadata`; core's catch-all does that for it. Core
 * used to build the title out of the last URL segment, which is right only
 * when the URL is known to name something real.
 *
 * On a route whose page resolves server-side and calls `notFound()`, it is:
 * the response is a 404 and Next replaces this metadata with the not-found
 * page's. On a route whose page answers 200 and renders "not found" in the
 * browser, it is not. `/store/product/999999/free-nitro-generator` came back
 * 200 with `<title>`, `og:title` and `twitter:title` all reading "Free Nitro
 * Generator" beside the site's own name, which is exactly what an unfurled
 * link shows in Discord or Twitter. Any visitor could mint one on the site's
 * domain. With `custom-pages` installed the route is `/[slug]`, so it was
 * every unrecognised URL on the site, not just the ones under a module.
 *
 * So a URL segment names the page only where a module has declared
 * `titleFromPath`, which `validate-module` grants only to a server page that
 * calls `notFound()`. Everywhere else the title comes from the route pattern
 * the module itself declared, which no visitor can influence.
 *
 * That pattern is a URL, and a URL is written once, in English. A Turkish
 * visitor reading "Mağaza" under an <h1> had "Store | Blysis" in the browser
 * tab and in the search result, and `/store/vip` was titled "Vip", which is
 * not a word in either language. So a route may also declare `titleKey`, a
 * key into the translations the module already ships, and the humanized
 * segment becomes the fallback for a module that declares none.
 */

const DYNAMIC_SEGMENT = /^\[.*\]$/;

/** How long a path-derived title may be before it stops looking like a title. */
const MAX_TITLE_LENGTH = 120;

/**
 * How long a declared description may be before it stops being a snippet.
 *
 * Search engines cut a snippet around 160 characters, but a module is allowed
 * to write a longer sentence and have the engine do the cutting. The ceiling
 * exists only to reject a key that has been pointed at a paragraph of body
 * copy by mistake.
 */
const MAX_DESCRIPTION_LENGTH = 320;

/** "server-launch" -> "Server Launch" */
export function humanizeSegment(segment: string): string {
    return segment
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * @param slug        the requested path, split into segments
 * @param routePattern the matched route's declared path, e.g. `/store/product/[...params]`
 * @param titleFromPath whether that route declared the URL trustworthy
 */
export function moduleRouteTitle(
    slug: string[] | undefined,
    routePattern?: string,
    titleFromPath?: boolean,
): string {
    if (titleFromPath && slug && slug.length > 0) {
        const fromUrl = humanizeSegment(slug[slug.length - 1]);
        if (fromUrl && fromUrl.length <= MAX_TITLE_LENGTH) return fromUrl;
    }

    if (routePattern) {
        const literal = routePattern
            .split("/")
            .filter((segment) => segment && !DYNAMIC_SEGMENT.test(segment))
            .pop();
        if (literal) {
            const fromRoute = humanizeSegment(literal);
            if (fromRoute) return fromRoute;
        }
    }

    return "Page";
}

/**
 * Look a dotted `namespace.key` up in a message catalogue.
 *
 * Returns null rather than the key itself for anything missing or not a
 * string: the caller has a fallback, and a title reading `store.pageTitle`
 * is worse than one reading "Store".
 */
export function titleFromMessages(
    messages: Record<string, unknown> | null | undefined,
    titleKey: string | undefined,
): string | null {
    return messageAt(messages, titleKey, MAX_TITLE_LENGTH);
}

/**
 * The same lookup for a route's declared `descriptionKey`.
 *
 * Separate from the title only because the two have different ceilings: a
 * description that tripped the title's 120 characters was silently dropped
 * back to the site-wide sentence, which is the defect this exists to fix.
 */
export function descriptionFromMessages(
    messages: Record<string, unknown> | null | undefined,
    descriptionKey: string | undefined,
): string | null {
    return messageAt(messages, descriptionKey, MAX_DESCRIPTION_LENGTH);
}

function messageAt(
    messages: Record<string, unknown> | null | undefined,
    dotted: string | undefined,
    maxLength: number,
): string | null {
    if (!messages || !dotted) return null;
    let node: unknown = messages;
    for (const segment of dotted.split(".")) {
        if (!node || typeof node !== "object") return null;
        node = (node as Record<string, unknown>)[segment];
    }
    if (typeof node !== "string") return null;
    const text = node.trim();
    if (!text || text.length > maxLength) return null;
    return text;
}

export interface RouteTitleInput {
    /** The requested path, split into segments. */
    slug?: string[];
    /** The matched route's declared path, e.g. `/store/product/[...params]`. */
    routePattern?: string;
    /** Whether that route declared the URL trustworthy. */
    titleFromPath?: boolean;
    /** The route's declared translation key, if it has one. */
    titleKey?: string;
    /** The visitor's message catalogue, core and modules merged. */
    messages?: Record<string, unknown> | null;
}

/**
 * The title for a module page, in the visitor's language where the module
 * said what it is called.
 *
 * `titleFromPath` still wins: a route that declared it names a resource the
 * URL identifies (a product, an article), which is more specific than any
 * static page name and is already the resource's own words.
 */
export function resolveRouteTitle(input: RouteTitleInput): string {
    if (input.titleFromPath && input.slug && input.slug.length > 0) {
        return moduleRouteTitle(input.slug, input.routePattern, true);
    }
    return (
        titleFromMessages(input.messages, input.titleKey) ??
        moduleRouteTitle(input.slug, input.routePattern, false)
    );
}
