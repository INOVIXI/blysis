import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * What a core page puts in the visitor's tab, and what it tells a crawler.
 *
 * Ten of core's own pages shipped with no title and no description of their
 * own. Only `generateMetadata` can name a page, it is a server export, and
 * these pages are client components, so the root layout's `title.default` was
 * all that was left. Measured on the demo, in English:
 *
 *     /auth/login            title "Blysis"   description none
 *     /auth/register         title "Blysis"   description none
 *     /auth/forgot-password  title "Blysis"   description none
 *     /auth/reset-password   title "Blysis"   description none
 *     /auth/verify-email     title "Blysis"   description none
 *     /auth/error            title "Blysis"   description none
 *     /profile               title "Blysis"   description none
 *     /search                title "Blysis"   description none
 *     /maintenance           title "Blysis"   description none
 *
 * Every one of them already shipped a translated heading. The h1 on the login
 * screen said "Welcome Back" and "Hoş Geldin"; the tab said the site name in
 * both languages. `/activity` was the one page with a description.
 *
 * The second half is the canonical tag. Every route on this site lives under a
 * locale segment, so `/store` is a 307 and `/en/store` is the page. The
 * sitemap has published the `hreflang` set for a while and the pages said
 * nothing at all, so the claim existed on one side only. `buildPageMeta` now
 * emits both when it is told the locale, and refuses to guess when it is not:
 * a canonical pointing at the wrong URL is worse than no canonical.
 *
 * That last part is why the root layout still emits neither. Metadata is
 * inherited, and `alternates` set there would be inherited by every page that
 * sets none of its own - every admin screen and the setup wizard - each of
 * them then claiming to be the home page.
 */

const ROOT = process.cwd();
const LOCALE_ROOT = path.join(ROOT, "src/app/[locale]");

const { setting, resolveAppUrl, serverConfig, ensureHooks } = vi.hoisted(() => ({
    setting: { findMany: vi.fn(async () => []) },
    resolveAppUrl: vi.fn(() => "https://games.example"),
    serverConfig: { name: "Blysis", description: "Default description" },
    ensureHooks: vi.fn(async () => {}),
}));
vi.mock("@/core/lib/db", () => ({ prisma: { setting }, default: { setting } }));
vi.mock("@/core/lib/app-url", () => ({ resolveAppUrl }));
vi.mock("@/core/config/server", () => ({ serverConfig }));
vi.mock("@/core/lib/hooks-bootstrap", () => ({ ensureHooks }));

const { CORE_SCREENS, coreScreen } = await import("@/core/lib/core-screens");
const { buildPageMeta } = await import("@/core/lib/seo");
const { locales, defaultLocale } = await import("@/core/lib/i18n/config");

/** Every public page core renders, as a path below the locale segment. */
function corePublicPages(): string[] {
    const out: string[] = [];
    const walk = (dir: string, url: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        if (entries.some((e) => e.isFile() && e.name === "page.tsx")) out.push(url || "/");
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (entry.name === "(admin)" || entry.name === "(setup)") continue;
            if (entry.name.startsWith("[")) continue;
            const grouped = entry.name.startsWith("(") && entry.name.endsWith(")");
            walk(path.join(dir, entry.name), grouped ? url : `${url}/${entry.name}`);
        }
    };
    walk(LOCALE_ROOT, "");
    return out.sort();
}

/** True when the page at `url` names itself: its own file, or a sibling layout. */
function namesItself(url: string): boolean {
    const dir = pageDir(url);
    if (!dir) return false;
    for (const file of ["page.tsx", "layout.tsx"]) {
        const full = path.join(dir, file);
        if (fs.existsSync(full) && /export (async function|const) generateMetadata/.test(fs.readFileSync(full, "utf8"))) {
            return true;
        }
    }
    return false;
}

function pageDir(url: string): string | null {
    const walk = (dir: string, current: string): string | null => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        if (current === url && entries.some((e) => e.isFile() && e.name === "page.tsx")) return dir;
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const grouped = entry.name.startsWith("(") && entry.name.endsWith(")");
            const next = grouped ? current : `${current}/${entry.name}`;
            if (!grouped && !url.startsWith(next)) continue;
            const found = walk(path.join(dir, entry.name), next);
            if (found) return found;
        }
        return null;
    };
    return walk(LOCALE_ROOT, "");
}

/**
 * Pages that carry no metadata of their own on purpose. The home page is the
 * site: the root layout's title and description are already its own, and it
 * cannot take a sibling layout because the root layout occupies that slot.
 */
const SITE_LEVEL_BY_DESIGN = new Set(["/"]);

describe("every public page core renders", () => {
    const pages = corePublicPages();

    it("is found by the scan at all", () => {
        expect(pages.length).toBeGreaterThan(8);
        expect(pages).toContain("/auth/login");
        expect(pages).toContain("/maintenance");
    });

    it("names itself, or is site-level on purpose", () => {
        const nameless = pages.filter((p) => !SITE_LEVEL_BY_DESIGN.has(p) && !namesItself(p));
        expect(nameless).toEqual([]);
    });

    it("resolves each declared screen to a page that exists", () => {
        const missing = CORE_SCREENS.filter((s) => !pageDir(s.path)).map((s) => s.path);
        expect(missing).toEqual([]);
    });

    it("would have failed before the layouts existed", () => {
        // namesItself is the whole rule, so it has to be able to say no.
        expect(namesItself("/auth/login")).toBe(true);
        expect(namesItself("/nothing-here")).toBe(false);
    });
});

describe("every declared screen", () => {
    const messages = Object.fromEntries(
        locales.map((locale) => [
            locale,
            JSON.parse(fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8")) as Record<
                string,
                Record<string, string>
            >,
        ]),
    );

    const lookup = (locale: string, dotted: string): unknown => {
        const [namespace, ...rest] = dotted.split(".");
        return messages[locale]?.[namespace]?.[rest.join(".")];
    };

    it("has screens to check", () => {
        expect(CORE_SCREENS.length).toBeGreaterThanOrEqual(9);
    });

    it("ships its title and description in every locale", () => {
        const missing: string[] = [];
        for (const screen of CORE_SCREENS) {
            for (const locale of locales) {
                for (const key of [screen.titleKey, screen.descriptionKey]) {
                    const value = lookup(locale, key);
                    if (typeof value !== "string" || !value.trim()) missing.push(`${locale}: ${key}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it("says something different from the site name", () => {
        // The defect was every tab reading "Blysis"; a key resolving to that
        // would reproduce it while passing the test above.
        const same = CORE_SCREENS.filter((s) => lookup("en", s.titleKey) === serverConfig.name).map((s) => s.path);
        expect(same).toEqual([]);
    });

    it("gives no two screens the same title", () => {
        for (const locale of locales) {
            const titles = CORE_SCREENS.map((s) => lookup(locale, s.titleKey));
            expect(new Set(titles).size, locale).toBe(CORE_SCREENS.length);
        }
    });

    it("translates, rather than repeating the English", () => {
        const untranslated = CORE_SCREENS.filter((s) => lookup("en", s.titleKey) === lookup("tr", s.titleKey)).map(
            (s) => s.path,
        );
        expect(untranslated).toEqual([]);
    });

    it("keeps a crawler out of the two pages it has no business indexing", () => {
        // Site search answers an unbounded set of `?q=` URLs with one shell,
        // and the maintenance page is an apology for the site being down.
        expect(coreScreen("/search")?.index).toBe(false);
        expect(coreScreen("/maintenance")?.index).toBe(false);
    });

    it("leaves the robots-disallowed screens without a meta noindex", () => {
        // A crawler told not to fetch the URL never reads the tag, so a
        // noindex there would be a claim with no reader.
        const disallowed = CORE_SCREENS.filter((s) => s.path.startsWith("/auth") || s.path === "/profile");
        expect(disallowed.length).toBeGreaterThan(5);
        expect(disallowed.filter((s) => s.index === false)).toEqual([]);
    });
});

describe("the canonical tag", () => {
    it("names the URL the visitor is on, locale segment and all", async () => {
        const meta = await buildPageMeta({ title: "Store", url: "/store", locale: "tr" });
        expect(meta.alternates?.canonical).toBe("https://games.example/tr/store");
    });

    it("carries every locale plus an x-default", async () => {
        const meta = await buildPageMeta({ title: "Store", url: "/store", locale: "en" });
        const languages = meta.alternates?.languages as Record<string, string>;
        for (const locale of locales) expect(languages[locale]).toBe(`https://games.example/${locale}/store`);
        expect(languages["x-default"]).toBe(`https://games.example/${defaultLocale}/store`);
    });

    it("writes the home page without a trailing slash", async () => {
        const meta = await buildPageMeta({ title: "Home", url: "/", locale: "en" });
        expect(meta.alternates?.canonical).toBe("https://games.example/en");
    });

    it("says nothing when it has not been told the language", async () => {
        expect((await buildPageMeta({ title: "Store", url: "/store" })).alternates).toBeUndefined();
    });

    it("says nothing for a locale this site does not serve", async () => {
        expect((await buildPageMeta({ title: "Store", url: "/store", locale: "de" })).alternates).toBeUndefined();
        expect((await buildPageMeta({ title: "Store", url: "/store", locale: "" })).alternates).toBeUndefined();
    });

    it("does not touch a URL that is already absolute", async () => {
        const meta = await buildPageMeta({ title: "X", url: "https://elsewhere.example/x", locale: "en" });
        expect(meta.alternates).toBeUndefined();
    });
});

describe("the pages that ask for the canonical", () => {
    const reads = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

    it("passes the locale from every page that builds its own metadata", () => {
        // A comment may sit between the two lines; the locale may not go away.
        expect(reads("src/app/[locale]/[...slug]/page.tsx")).toMatch(/locale,\n(?:\s*\/\/[^\n]*\n)*\s+type:/);
        // `/activity` wrote its own head here and was the one core page with a
        // description of any kind. It is a row in the table now, and the table
        // passes the locale for every screen in it, so the guarantee moved
        // rather than went away.
        expect(reads("src/app/[locale]/(public)/activity/page.tsx")).toContain('coreScreenMetadata("/activity")');
        expect(reads("src/core/lib/core-screens.ts")).toMatch(/locale,\n\s+type:/);
    });

    it("leaves the root layout emitting none", () => {
        // Deliberate: see the header. An inherited canonical would put the
        // home page's URL on every admin screen.
        const source = reads("src/app/[locale]/layout.tsx");
        const fn = source.slice(source.indexOf("export async function generateMetadata"));
        expect(fn.slice(0, 400)).not.toContain("locale");
        expect(fn.slice(0, 400)).not.toContain("alternates");
    });
});
