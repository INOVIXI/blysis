import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
    CORE_STATIC_ROUTES,
    DISALLOWED_PREFIXES,
    disallowedPaths,
    isCrawlable,
    localeAlternates,
    localizedPath,
    localizedPaths,
    staticModuleRoutes,
} from "@/core/lib/sitemap-routes";
import { locales, defaultLocale } from "@/core/lib/i18n/config";

const ROUTES = [
    { path: "/store", module: "store" },
    { path: "/store/cart", module: "store" },
    { path: "/u/[username]", module: "member-profiles" },
    { path: "/vote", module: "vote" },
    { path: "/admin/announcements", module: "announcements", isAdmin: true },
];

describe("isCrawlable", () => {
    it("rejects a disallowed prefix and the paths under it", () => {
        expect(isCrawlable("/auth")).toBe(false);
        expect(isCrawlable("/auth/login")).toBe(false);
        expect(isCrawlable("/admin/modules")).toBe(false);
    });

    it("accepts a path that merely starts with the same letters", () => {
        expect(isCrawlable("/apiaries")).toBe(true);
        expect(isCrawlable("/profiles-of-note")).toBe(true);
    });
});

describe("CORE_STATIC_ROUTES", () => {
    it("publishes nothing robots.txt disallows", () => {
        const blocked = CORE_STATIC_ROUTES.filter((r) => !isCrawlable(r.path));
        expect(blocked).toEqual([]);
    });
});

describe("staticModuleRoutes", () => {
    const enabled = { store: true, vote: true, "member-profiles": true, announcements: true };

    it("lists the static public pages of enabled modules", () => {
        expect(staticModuleRoutes(ROUTES, enabled)).toEqual(["/store", "/store/cart", "/vote"]);
    });

    it("skips a dynamic path, whose values only the module knows", () => {
        expect(staticModuleRoutes(ROUTES, enabled)).not.toContain("/u/[username]");
    });

    it("skips admin routes", () => {
        expect(staticModuleRoutes(ROUTES, enabled)).not.toContain("/admin/announcements");
    });

    it("skips a module that is installed but disabled", () => {
        expect(staticModuleRoutes(ROUTES, { ...enabled, store: false })).toEqual(["/vote"]);
    });

    it("returns nothing when no module is enabled", () => {
        expect(staticModuleRoutes(ROUTES, {})).toEqual([]);
    });

    it("deduplicates a path two modules both route", () => {
        const dupes = [
            { path: "/vote", module: "vote" },
            { path: "/vote", module: "vote" },
        ];
        expect(staticModuleRoutes(dupes, enabled)).toEqual(["/vote"]);
    });
});

describe("robots.txt and the sitemap", () => {
    const root = path.resolve(import.meta.dirname, "../..");

    it("read their lists from the same place", () => {
        const robots = fs.readFileSync(path.join(root, "src/app/robots.ts"), "utf8");
        const sitemap = fs.readFileSync(path.join(root, "src/app/sitemap.ts"), "utf8");
        expect(robots).toContain("disallowedPaths");
        expect(sitemap).toContain("CORE_STATIC_ROUTES");
        expect(sitemap).toContain("staticModuleRoutes");
    });

    it("publish locale-prefixed URLs, never a bare path that only redirects", () => {
        const sitemap = fs.readFileSync(path.join(root, "src/app/sitemap.ts"), "utf8");
        expect(sitemap).toContain("localizedPaths");
        expect(sitemap).toContain("localeAlternates");
        // A bare `${siteUrl}${path}` is exactly the bug: a 307, not a page.
        expect(sitemap).not.toMatch(/url: `\$\{siteUrl\}\$\{r\.path\}`/);
    });

    it("do not stamp a made-up lastmod on a page core knows nothing about", () => {
        const sitemap = fs.readFileSync(path.join(root, "src/app/sitemap.ts"), "utf8");
        expect(sitemap).not.toContain("lastModified: now");
    });

    it("names every prefix robots.txt is meant to block", () => {
        expect([...DISALLOWED_PREFIXES]).toEqual(["/admin", "/api", "/auth", "/profile"]);
    });
});

describe("noindex routes", () => {
    const enabled = { store: true };
    const routes = [
        { path: "/store", module: "store" },
        { path: "/store/cart", module: "store", noindex: true },
    ];

    it("keeps a route the module marked noindex out of the sitemap", () => {
        expect(staticModuleRoutes(routes, enabled)).toEqual(["/store"]);
    });
});

describe("locale-prefixed paths", () => {
    it("puts the locale first", () => {
        expect(localizedPath("/store", "tr")).toBe("/tr/store");
    });

    it("writes the home page without a trailing slash", () => {
        expect(localizedPath("/", "en")).toBe("/en");
    });

    it("covers every locale the site serves, in order", () => {
        expect(localizedPaths("/vote")).toEqual(locales.map((l) => `/${l}/vote`));
    });

    it("never returns a path a crawler would be redirected away from", () => {
        for (const p of localizedPaths("/store")) {
            expect(p.startsWith(`/${p.split("/")[1]}/`)).toBe(true);
            expect(locales).toContain(p.split("/")[1] as (typeof locales)[number]);
        }
    });
});

describe("hreflang alternates", () => {
    const site = "https://example.test";

    it("names every locale plus an x-default", () => {
        const alt = localeAlternates(site, "/store");
        expect(Object.keys(alt).sort()).toEqual([...locales, "x-default"].sort());
    });

    it("points x-default at the default locale", () => {
        const alt = localeAlternates(site, "/store");
        expect(alt["x-default"]).toBe(`${site}/${defaultLocale}/store`);
    });

    it("uses absolute URLs, which is what the sitemap protocol requires", () => {
        for (const url of Object.values(localeAlternates(site, "/vote"))) {
            expect(url.startsWith(`${site}/`)).toBe(true);
        }
    });
});

describe("what robots.txt actually writes", () => {
    it("blocks each prefix under every locale, not only the bare form", () => {
        const disallowed = disallowedPaths();
        for (const prefix of DISALLOWED_PREFIXES) {
            expect(disallowed).toContain(prefix);
            if (prefix === "/api") continue;
            for (const locale of locales) expect(disallowed).toContain(`/${locale}${prefix}`);
        }
    });

    it("does not localize /api, the one route group with no locale segment", () => {
        expect(disallowedPaths()).not.toContain(`/${defaultLocale}/api`);
    });

    it("blocks every URL the admin, auth and profile screens are actually served at", () => {
        const real = ["/en/admin/modules", "/tr/admin", "/en/auth/login", "/tr/profile"];
        for (const url of real) {
            const blocked = disallowedPaths().some((d) => url === d || url.startsWith(`${d}/`));
            expect(blocked, `${url} is not blocked`).toBe(true);
        }
    });

    it("leaves the public pages alone", () => {
        const publicUrls = ["/en", "/tr/store", "/en/vote", "/tr/activity"];
        for (const url of publicUrls) {
            const blocked = disallowedPaths().some((d) => url === d || url.startsWith(`${d}/`));
            expect(blocked, `${url} is blocked`).toBe(false);
        }
    });

    it("does not block a path that merely starts with the same letters", () => {
        const blocked = disallowedPaths().some(
            (d) => "/en/profiles-of-note" === d || "/en/profiles-of-note".startsWith(`${d}/`),
        );
        expect(blocked).toBe(false);
    });
});
