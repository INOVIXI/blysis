/**
 * The mode a visitor picked outlives the page load that follows it.
 *
 * Three things wrote `data-mode` on the root element and they disagreed. An
 * inline script in `<head>` applied the visitor's choice from localStorage
 * before paint; the theme provider's effect then set it to the site's own
 * configured mode; and the toggle set it a third time. Measured against a
 * running server on 2026-09-15 with `color-mode=dark` stored: `dark` before
 * hydration, `light` after. So picking dark, reloading, and watching the page
 * turn light again was the whole experience of the setting.
 *
 * `resolveMode` had been written for the answer - it takes a `cookie` - and
 * nothing ever passed one, so that branch had never run. The visitor's choice
 * is a cookie now, the server renders `data-mode` from it, and the inline
 * script is gone with the flash it was there to prevent.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolveMode } from "@/core/lib/theme-mode";

const ROOT = process.cwd();
const TWO_MODES = { modes: { default: "light", available: { light: {}, dark: {} } } };

describe("the mode a page is drawn in", () => {
    it("follows the visitor's own choice over the site's default", () => {
        expect(resolveMode({ manifest: TWO_MODES, siteDefault: "light", cookie: "dark" })).toBe("dark");
        expect(resolveMode({ manifest: TWO_MODES, siteDefault: "dark", cookie: "light" })).toBe("light");
    });

    it("falls back to the site's default when the visitor has not chosen", () => {
        expect(resolveMode({ manifest: TWO_MODES, siteDefault: "dark" })).toBe("dark");
        expect(resolveMode({ manifest: TWO_MODES, siteDefault: "dark", cookie: "nonsense" })).toBe("dark");
    });

    it("still lets a forced mode win, which is what the preview needs", () => {
        expect(resolveMode({ manifest: TWO_MODES, forced: "light", cookie: "dark" })).toBe("light");
    });

    it("gives a single-mode theme its one mode whatever anybody asked for", () => {
        const one = { modes: { default: "light", available: { light: {} } } };
        expect(resolveMode({ manifest: one, cookie: "dark", siteDefault: "dark" })).toBe("light");
    });
});

describe("the page the server sends", () => {
    const layout = fs.readFileSync(path.join(ROOT, "src/app/[locale]/layout.tsx"), "utf8");

    it("carries the mode as an attribute rather than a script that sets one", () => {
        // A `<script>` in a React tree is also what the dev build warns about:
        // rendered on the client it never runs, so React asks for it not to be
        // there. The answer to both is the same - the server knows the mode.
        expect(layout).not.toContain("localStorage.getItem('color-mode')");
        expect(layout).toMatch(/data-mode=/);
    });

    it("reads the choice from the cookie the toggle writes", () => {
        const hook = fs.readFileSync(path.join(ROOT, "src/core/hooks/useDarkMode.ts"), "utf8");
        expect(hook).toContain("document.cookie");
        // The read sits with the theme, not in the layout, so the colour
        // overrides - which are keyed by mode - are fetched for the mode the
        // page is actually drawn in.
        const state = fs.readFileSync(path.join(ROOT, "src/core/lib/theme-state.ts"), "utf8");
        expect(state).toContain("COLOR_MODE_COOKIE");
        expect(state).toContain("resolveMode(");
    });
});
