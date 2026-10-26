/**
 * A site speaks the languages its operator offers, and opens in the one they
 * chose.
 *
 * The setup wizard asks which language the site is in and writes the answer
 * to `default_locale`, and nothing read it: every site opened in English,
 * whatever its operator had said, and every one of the twelve languages was
 * offered to every visitor, in the footer, in the sitemap and in each page's
 * `hreflang`, whether or not anybody had looked at a word of it. An operator
 * now chooses which languages the site offers and which it opens in. A
 * visitor who arrives without a language is given the one they asked their
 * browser for if it is offered, otherwise the site's; one who follows a link
 * into a language the site does not offer is taken to the same page in the
 * site's. The panel keeps every language, because the operator reading it
 * chose theirs.
 */
import { describe, it, expect } from "vitest";
import { languageFor, languageRedirect, siteLanguagesOf } from "@/core/lib/i18n/site-languages";
import { localeAlternates, localizedPaths } from "@/core/lib/sitemap-routes";

const TURKISH_SITE = siteLanguagesOf(["tr", "en"], "tr");

describe("the languages a site offers", () => {
    it("are every language until the operator says otherwise, opening in the one setup chose", () => {
        const site = siteLanguagesOf(undefined, "tr");
        expect(site.offered).toHaveLength(12);
        expect(site.preferred).toBe("tr");
        expect(siteLanguagesOf(undefined, undefined).preferred).toBe("en");
    });

    it("are read in the order the software lists them, unknown ones and repeats dropped", () => {
        expect(siteLanguagesOf(JSON.stringify(["tr", "xx", "en", "tr"]), "tr").offered).toEqual(["en", "tr"]);
    });

    it("never open in a language they do not offer, and are never none", () => {
        expect(siteLanguagesOf(["tr", "de"], "fr").preferred).toBe("tr");
        expect(siteLanguagesOf(["de", "en"], "fr").preferred).toBe("en");
        expect(siteLanguagesOf([], "tr").offered).toHaveLength(12);
        expect(siteLanguagesOf("not json", "tr").offered).toHaveLength(12);
    });
});

describe("a visitor who arrives without a language", () => {
    it("is given the one they chose before, if it is offered", () => {
        expect(languageFor(TURKISH_SITE, { cookie: "en", acceptLanguage: "tr" })).toBe("en");
        expect(languageFor(TURKISH_SITE, { cookie: "de", acceptLanguage: "" })).toBe("tr");
    });

    it("is given the one their browser asks for, if it is offered, and the site's otherwise", () => {
        expect(languageFor(TURKISH_SITE, { acceptLanguage: "de-DE,de;q=0.9,en-US;q=0.8" })).toBe("en");
        expect(languageFor(TURKISH_SITE, { acceptLanguage: "fr-FR,fr;q=0.9" })).toBe("tr");
        expect(languageFor(TURKISH_SITE, {})).toBe("tr");
    });

    it("is sent to that language's page", () => {
        expect(languageRedirect("/", TURKISH_SITE, { acceptLanguage: "fr" })).toBe("/tr");
        expect(languageRedirect("/store/vip", TURKISH_SITE, { acceptLanguage: "en" })).toBe("/en/store/vip");
    });
});

describe("a link into a language the site does not offer", () => {
    it("lands on the same page in the site's language", () => {
        expect(languageRedirect("/de/store/vip", TURKISH_SITE, {})).toBe("/tr/store/vip");
        expect(languageRedirect("/de", TURKISH_SITE, {})).toBe("/tr");
    });

    it("leaves an offered one where it is", () => {
        expect(languageRedirect("/en/store", TURKISH_SITE, {})).toBeNull();
        expect(languageRedirect("/tr", TURKISH_SITE, {})).toBeNull();
    });

    it("leaves the panel in whatever language its reader chose", () => {
        expect(languageRedirect("/de/admin", TURKISH_SITE, {})).toBeNull();
        expect(languageRedirect("/de/admin/translations", TURKISH_SITE, {})).toBeNull();
    });
});

describe("what a crawler is told", () => {
    it("names only the languages offered, and the site's as the default", () => {
        expect(localizedPaths("/store", TURKISH_SITE)).toEqual(["/en/store", "/tr/store"]);
        expect(localeAlternates("https://x.example", "/store", TURKISH_SITE)).toEqual({
            en: "https://x.example/en/store",
            tr: "https://x.example/tr/store",
            "x-default": "https://x.example/tr/store",
        });
    });
});
