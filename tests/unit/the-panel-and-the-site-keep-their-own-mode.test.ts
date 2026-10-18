/**
 * The admin panel and the public site each keep their own light/dark mode.
 *
 * They shared one: `<html data-mode>` from one `color-mode` cookie, and the
 * panel's moon button wrote the same cookie as the site's. An operator who
 * wanted a dark panel got a dark site too, and one who wanted a light site
 * could only have it by working in a light panel. The panel now has its own
 * choice, which by default is "whatever the site is" - the old behaviour,
 * for anybody who liked it.
 *
 * Two site-wide settings come with it. A site can follow the reader's
 * operating system rather than pick for them, and a site can hold its mode
 * - a dark-only brand - so the visitor's toggle is gone and an old choice is
 * not honoured. Neither reaches into the panel.
 */
import { describe, it, expect } from "vitest";
import { resolveMode, resolvePageMode, SYSTEM_MODE } from "@/core/lib/theme-mode";

const BOTH = { modes: { default: "light", available: { light: {}, dark: {} } } };
const DARK_FIRST = { modes: { default: "dark", available: { light: {}, dark: {} } } };
const ONE = { modes: { default: "light", available: { light: {} } } };

describe("a site that follows the reader's system", () => {
    it("is dark for a reader whose system is dark", () => {
        expect(resolveMode({ manifest: BOTH, siteDefault: SYSTEM_MODE, systemPrefersDark: true })).toBe("dark");
    });

    it("is light for a reader whose system is light, whatever the theme leans to", () => {
        expect(resolveMode({ manifest: DARK_FIRST, siteDefault: SYSTEM_MODE, systemPrefersDark: false })).toBe("light");
    });

    it("still gives way to a reader who chose", () => {
        expect(resolveMode({ manifest: BOTH, siteDefault: SYSTEM_MODE, systemPrefersDark: true, cookie: "light" })).toBe("light");
    });

    it("cannot make a one-mode theme into something it is not", () => {
        expect(resolveMode({ manifest: ONE, siteDefault: SYSTEM_MODE, systemPrefersDark: true })).toBe("light");
    });
});

describe("the page a request is drawn in", () => {
    const base = { manifest: BOTH, siteDefault: "light", locked: false, siteCookie: null, adminCookie: null, systemScheme: null } as const;

    it("draws the site in the visitor's choice", () => {
        expect(resolvePageMode({ ...base, surface: "site", siteCookie: "dark" })).toBe("dark");
    });

    it("draws the panel in the panel's choice, not the site's", () => {
        expect(resolvePageMode({ ...base, surface: "admin", siteCookie: "light", adminCookie: "dark" })).toBe("dark");
        expect(resolvePageMode({ ...base, surface: "site", siteCookie: "light", adminCookie: "dark" })).toBe("light");
    });

    it("draws the panel like the site when the panel has not chosen, or chose the site", () => {
        expect(resolvePageMode({ ...base, surface: "admin", siteCookie: "dark" })).toBe("dark");
        expect(resolvePageMode({ ...base, surface: "admin", siteCookie: "dark", adminCookie: "site" })).toBe("dark");
    });

    it("ignores the visitor's choice on a site that holds its mode", () => {
        const held = { ...base, siteDefault: "dark", locked: true };
        expect(resolvePageMode({ ...held, surface: "site", siteCookie: "light" })).toBe("dark");
    });

    it("does not hold the panel to the site's lock", () => {
        const held = { ...base, siteDefault: "dark", locked: true };
        expect(resolvePageMode({ ...held, surface: "admin", adminCookie: "light" })).toBe("light");
        // A panel that follows the site follows the site as it is drawn.
        expect(resolvePageMode({ ...held, surface: "admin", siteCookie: "light" })).toBe("dark");
    });

    it("reads the reader's system from what the browser said", () => {
        const system = { ...base, siteDefault: SYSTEM_MODE };
        expect(resolvePageMode({ ...system, surface: "site", systemScheme: "dark" })).toBe("dark");
        expect(resolvePageMode({ ...system, surface: "site", systemScheme: "light" })).toBe("light");
    });
});
