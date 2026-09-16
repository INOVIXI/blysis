import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * What a page tells a search engine it is about.
 *
 * Every public page a module serves shipped without one. A page can only say
 * so through `generateMetadata`, core writes that for module pages, and the
 * only thing a route declared was its name - so `buildPageMeta` fell through
 * to the single `site_description` row for all of them. Measured on the demo,
 * in English, the store, the forum, the leaderboard, the blog and thirty-four
 * others all carried the same sentence as their meta description and their
 * og:description, which is one search snippet repeated thirty-eight times.
 *
 * The screen that manages SEO had the same hole from the other side: it could
 * offer no default to override, because there was none.
 *
 * So a route declares `descriptionKey` beside `titleKey`, resolved against the
 * translations the module already ships, in both locales.
 */

const ROOT = process.cwd();
const SOURCES = path.join(ROOT, "module-sources");
const LOCALES = ["en", "tr"] as const;

interface Route {
    module: string;
    path: string;
    titleKey?: string;
    descriptionKey?: string;
    ogType?: string;
}

interface Manifest {
    id: string;
    routes?: Route[];
    translations?: Record<string, Record<string, Record<string, string>>>;
}

function manifests(): Manifest[] {
    return fs
        .readdirSync(SOURCES, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(SOURCES, e.name, "module.json"))
        .filter((file) => fs.existsSync(file))
        .map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as Manifest);
}

function publicRoutes(): { manifest: Manifest; route: Route }[] {
    return manifests().flatMap((manifest) =>
        (manifest.routes ?? []).map((route) => ({ manifest, route })),
    );
}

/** A `namespace.key` looked up in one module's own catalogue for one locale. */
function declared(manifest: Manifest, locale: string, dotted: string | undefined): string | null {
    if (!dotted) return null;
    const [namespace, ...rest] = dotted.split(".");
    const value = manifest.translations?.[locale]?.[namespace]?.[rest.join(".")];
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

describe("what a module page says it is", () => {
    const catchAll = fs.readFileSync(path.join(ROOT, "src/app/[locale]/[...slug]/page.tsx"), "utf8");
    const routes = publicRoutes();

    it("takes its kind from the route rather than a constant", () => {
        expect(catchAll).toContain('type: route?.ogType ?? "website"');
        // It read `type: "article"` for every page core renders on a module's
        // behalf, so the cart, the leaderboard, the staff list and the vote
        // page all announced themselves as a piece of writing.
        expect(catchAll).not.toMatch(/type:\s*"article"/);
    });

    it("calls a page an article only where that page is one thing", () => {
        // An article is a single piece of writing, which means the URL names
        // it. A listing that claimed the type would be claiming to be its own
        // contents.
        const listings = routes
            .filter(({ route }) => route.ogType === "article" && !route.path.includes("["))
            .map(({ manifest, route }) => `${manifest.id}${route.path}`);
        expect(listings).toEqual([]);
    });

    it("has some route saying so, or the field is decoration", () => {
        const articles = routes.filter(({ route }) => route.ogType === "article");
        expect(articles.length).toBeGreaterThan(2);
    });
});

describe("every public page a module serves", () => {
    const routes = publicRoutes();

    it("is found by the scan at all", () => {
        expect(routes.length).toBeGreaterThan(30);
        expect(routes.map((r) => r.route.path)).toContain("/store");
    });

    it("declares what it is about", () => {
        const silent = routes.filter((r) => !r.route.descriptionKey).map((r) => `${r.manifest.id}${r.route.path}`);
        expect(silent).toEqual([]);
    });

    it("ships that description in every locale", () => {
        const missing: string[] = [];
        for (const { manifest, route } of routes) {
            for (const locale of LOCALES) {
                if (!declared(manifest, locale, route.descriptionKey)) {
                    missing.push(`${locale}: ${manifest.id}${route.path} -> ${route.descriptionKey}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it("translates it, rather than repeating the English", () => {
        const untranslated = routes
            .filter(({ manifest, route }) =>
                declared(manifest, "en", route.descriptionKey) === declared(manifest, "tr", route.descriptionKey),
            )
            .map((r) => `${r.manifest.id}${r.route.path}`);
        expect(untranslated).toEqual([]);
    });

    it("says something of its own, not the module's one-line summary", () => {
        // A description copied from the manifest's own `description` field
        // would pass every check above and still give two pages of one module
        // the same snippet.
        const reused = routes
            .filter(({ manifest, route }) => {
                const text = declared(manifest, "en", route.descriptionKey);
                return text !== null && text === (manifest as { description?: string }).description;
            })
            .map((r) => `${r.manifest.id}${r.route.path}`);
        expect(reused).toEqual([]);
    });

    it("can say no", () => {
        // The whole rule is `declared`, so it has to be able to fail.
        const [{ manifest }] = routes;
        expect(declared(manifest, "en", "pageDescriptions.nothingIsCalledThis")).toBeNull();
        expect(declared(manifest, "en", undefined)).toBeNull();
    });
});
