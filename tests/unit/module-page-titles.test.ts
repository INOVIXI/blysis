import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { moduleRouteTitle, humanizeSegment } from "@/core/lib/route-title";

/**
 * A module page is a component in a registry, so it cannot export
 * `generateMetadata` and core's catch-all titles it instead. Core used to take
 * the last URL segment, whatever it was, and put it in `<title>`, `og:title`
 * and `twitter:title`.
 *
 * That is safe only where a URL naming nothing answers 404, because then Next
 * throws this metadata away and renders the not-found page's instead. Every
 * dynamic public module page except the blog's resolves in the browser and
 * answers 200, so `/store/product/999999/free-nitro-generator` came back 200
 * titled "Free Nitro Generator" beside the site's own name: a link anyone
 * could mint that unfurls in Discord as the site's own page. With
 * `custom-pages` installed the route is `/[slug]`, so it covered every
 * unrecognised URL on the site.
 *
 * The URL names the page only where the module declared `titleFromPath` and
 * `validate-module` confirmed the page is a server component that calls
 * `notFound()`. This pins both halves.
 */

const ROOT = path.resolve(__dirname, "../..");
const SOURCES = path.join(ROOT, "module-sources");

interface Route {
    path: string;
    component: string;
    titleFromPath?: boolean;
}

const manifests = fs
    .readdirSync(SOURCES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(SOURCES, e.name, "module.json"))
    .filter((f) => fs.existsSync(f))
    .map((f) => ({
        dir: path.dirname(f),
        id: path.basename(path.dirname(f)),
        routes: (JSON.parse(fs.readFileSync(f, "utf8")).routes ?? []) as Route[],
    }));

describe("humanizeSegment", () => {
    it("turns a slug into words", () => {
        expect(humanizeSegment("server-launch")).toBe("Server Launch");
        expect(humanizeSegment("order_success")).toBe("Order Success");
        expect(humanizeSegment("store")).toBe("Store");
    });

    it("survives an empty segment", () => {
        expect(humanizeSegment("")).toBe("");
        expect(humanizeSegment("---")).toBe("");
    });
});

describe("moduleRouteTitle", () => {
    const attacker = ["store", "product", "999999", "free-nitro-generator"];

    it("names the page after the route, not the URL", () => {
        expect(moduleRouteTitle(attacker, "/store/product/[...params]")).toBe("Product");
    });

    it("ignores the URL even when the route ends in a dynamic segment", () => {
        expect(moduleRouteTitle(["u", "somebody"], "/u/[username]")).toBe("U");
    });

    it("uses the URL only where the route earned it", () => {
        expect(moduleRouteTitle(["blog", "1", "server-launch"], "/blog/[...params]", true))
            .toBe("Server Launch");
    });

    it("falls back to a neutral title when the route is all dynamic", () => {
        // custom-pages serves `/[slug]`, which has no literal segment to borrow.
        expect(moduleRouteTitle(["free-nitro-generator"], "/[slug]")).toBe("Page");
    });

    it("falls back when nothing matched at all", () => {
        expect(moduleRouteTitle(["nope"])).toBe("Page");
        expect(moduleRouteTitle(undefined)).toBe("Page");
    });

    it("refuses a path-derived title too long to be one", () => {
        const long = "a".repeat(200);
        expect(moduleRouteTitle(["blog", long], "/blog/[...params]", true)).toBe("Blog");
    });

    it("keeps a static route's own name", () => {
        expect(moduleRouteTitle(["store", "cart"], "/store/cart")).toBe("Cart");
        expect(moduleRouteTitle(["leaderboard"], "/leaderboard")).toBe("Leaderboard");
    });
});

describe("every route a module ships", () => {
    it("reads the manifests", () => {
        expect(manifests.length).toBeGreaterThan(50);
    });

    it("never lets a URL segment title a page it did not earn", () => {
        const leaked: string[] = [];
        for (const { id, routes } of manifests) {
            for (const route of routes) {
                if (route.titleFromPath) continue;
                // Walk the declared path, filling each dynamic segment with text
                // a visitor chose, and check none of it reaches the title.
                const slug = route.path
                    .split("/")
                    .filter(Boolean)
                    .map((segment) => (/^\[.*\]$/.test(segment) ? "free-nitro-generator" : segment));
                const title = moduleRouteTitle(slug, route.path, route.titleFromPath);
                if (/free.?nitro/i.test(title)) leaked.push(`${id}: ${route.path} -> ${title}`);
            }
        }
        expect(leaked).toEqual([]);
    });

    it("backs every titleFromPath claim with a server page that calls notFound", () => {
        const unearned: string[] = [];
        for (const { id, dir, routes } of manifests) {
            for (const route of routes) {
                if (!route.titleFromPath) continue;
                const component = path.join(dir, route.component);
                if (!fs.existsSync(component)) {
                    unearned.push(`${id}: ${route.path} (component missing)`);
                    continue;
                }
                const body = fs.readFileSync(component, "utf8");
                if (/^\s*["']use client["']/m.test(body)) {
                    unearned.push(`${id}: ${route.path} (client component)`);
                } else if (!/\bnotFound\s*\(\s*\)/.test(body)) {
                    unearned.push(`${id}: ${route.path} (never calls notFound)`);
                }
            }
        }
        expect(unearned).toEqual([]);
    });
});

describe("the catch-all that renders module pages", () => {
    const page = fs.readFileSync(
        path.join(ROOT, "src/app/[locale]/[...slug]/page.tsx"),
        "utf8",
    );

    it("asks the title resolver rather than reaching into the slug itself", () => {
        // resolveRouteTitle wraps moduleRouteTitle: same rule about when a URL
        // may name a page, plus the module's own translated name where it
        // declared one. See a-page-title-speaks-the-visitors-language.test.ts.
        expect(page).toContain("resolveRouteTitle({");
        expect(page).toContain("titleFromPath: route?.titleFromPath");
        expect(page).not.toMatch(/slug\[slug\.length - 1\]/);
    });

    it("tells crawlers not to index a path nothing serves", () => {
        expect(page).toMatch(/if \(!route\) \{[\s\S]*?index: false/);
    });
});
