// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * `/wp-login.php` returned 200 with the homepage.
 *
 * The proxy's page matcher skips any path containing a dot, which is how it
 * stays off files in /public. Nothing downstream checked the segment it
 * skipped, so a single-segment URL with a dot in it matched
 * `app/[locale]/page.tsx` with that string as the locale: the homepage went
 * out under `<html lang="wp-login.php">`. Every scanner probe got a 200, a
 * crawler got unbounded duplicate content on one real page, and the language
 * tag was one no screen reader can act on. `/index.php`, `/sitemap.xml.gz`
 * and anything else shaped that way did the same.
 *
 * The layout now refuses a segment that is not a locale this site serves.
 * Refusing means a 404, which is why the not-found pages come with it. The two
 * of them sit on opposite sides of that refusal: a `notFound()` thrown under a
 * locale renders `app/[locale]/not-found.tsx` inside the layout, which names
 * the language and loads the stylesheet, while a segment the layout itself
 * rejects takes the layout down with it and leaves `app/not-found.tsx` with
 * neither. Which file may carry an `<html>` is the subject of
 * tests/unit/app-shell-documents.test.ts; what is checked here is that a 404
 * still names a language where one is known, and reads its strings without the
 * provider.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const mockCookieGet = vi.fn();
const mockHeaderGet = vi.fn();
vi.mock("next/headers", () => ({
    cookies: async () => ({ get: (n: string) => mockCookieGet(n) }),
    headers: async () => ({ get: (n: string) => mockHeaderGet(n) }),
}));

import { isKnownLocale, resolveLocaleFromRequest, notFoundStrings } from "@/core/lib/i18n/resolve-locale";
import { locales, defaultLocale } from "@/core/lib/i18n/config";

beforeEach(() => {
    mockCookieGet.mockReset().mockReturnValue(undefined);
    mockHeaderGet.mockReset().mockReturnValue(null);
});

describe("what counts as a locale", () => {
    it("accepts every locale the site serves", () => {
        for (const locale of locales) expect(isKnownLocale(locale)).toBe(true);
    });

    it("refuses the shapes that reached the homepage", () => {
        for (const value of ["wp-login.php", "index.php", "sitemap.xml.gz", "foo.bar", "", "EN", "en-US", "..", "%2e%2e"]) {
            expect(isKnownLocale(value), value).toBe(false);
        }
    });

    it("refuses anything that is not a string", () => {
        for (const value of [undefined, null, 0, [], {}]) expect(isKnownLocale(value)).toBe(false);
    });
});

describe("resolving a locale with no segment to read", () => {
    it("takes the cookie first, because it records a choice", async () => {
        mockCookieGet.mockReturnValue({ value: "tr" });
        mockHeaderGet.mockReturnValue("en-US,en;q=0.9");
        expect(await resolveLocaleFromRequest()).toBe("tr");
    });

    it("falls to the header when there is no cookie", async () => {
        mockHeaderGet.mockReturnValue("tr-TR,tr;q=0.9,en;q=0.8");
        expect(await resolveLocaleFromRequest()).toBe("tr");
    });

    it("matches a region tag by its base language", async () => {
        mockHeaderGet.mockReturnValue("tr-TR");
        expect(await resolveLocaleFromRequest()).toBe("tr");
    });

    it("ignores a cookie naming a locale the site does not serve", async () => {
        mockCookieGet.mockReturnValue({ value: "ja" });
        mockHeaderGet.mockReturnValue("tr");
        expect(await resolveLocaleFromRequest()).toBe("tr");
    });

    it("falls back to the site default", async () => {
        expect(await resolveLocaleFromRequest()).toBe(defaultLocale);
        mockHeaderGet.mockReturnValue("ja-JP,ko;q=0.9");
        expect(await resolveLocaleFromRequest()).toBe(defaultLocale);
    });
});

describe("the strings a 404 needs", () => {
    it("still answers when the translation service throws", async () => {
        vi.doMock("@/core/lib/i18n/translation-service", () => ({
            getMessages: async () => { throw new Error("database is down"); },
        }));
        const t = await notFoundStrings("en");
        expect(t.title).toBeTruthy();
        expect(t.goHome).toBeTruthy();
        vi.doUnmock("@/core/lib/i18n/translation-service");
    });
});

describe("the layout", () => {
    const layout = read("src/app/[locale]/layout.tsx");

    it("refuses a segment that is not a locale", () => {
        expect(layout).toContain("if (!isKnownLocale(locale)) {");
        expect(layout).toContain("notFound();");
        // and does it before anything reads the database for that request
        expect(layout.indexOf("isKnownLocale(locale)")).toBeLessThan(layout.indexOf("await getMessages()"));
    });
});

describe("the not-found pages", () => {
    it("keep the root one readable without a stylesheet of ours", () => {
        // Nothing composes it, so it brings its own document and nothing has
        // loaded globals.css: its styles are inline, and its text is English
        // because no locale is resolved that far out.
        const src = read("src/app/not-found.tsx");
        expect(src).toMatch(/<html\b[^>]*lang=/);
        expect(src).toContain("style={{");
        expect(src).not.toContain("className=");
    });

    it("read their strings without the provider the layout mounts", () => {
        const src = read("src/app/[locale]/not-found.tsx");
        expect(src).not.toMatch(/\buseTranslations\s*\(/);
        expect(src).not.toMatch(/^\s*["']use client["']/m);
        expect(src).toContain("notFoundStrings");
        expect(src).toContain("resolveLocaleFromRequest");
    });

    it("name a language even when the request says nothing", () => {
        // resolveLocaleFromRequest always returns one of the site's locales,
        // so `lang` is never empty and never the raw URL segment. The root
        // not-found resolves nothing that far out and says so in its markup;
        // the locale one is composed inside the layout, which sets the tag
        // from the segment it has already checked.
        expect(read("src/app/[locale]/layout.tsx")).toContain("lang={locale}");
    });
});
