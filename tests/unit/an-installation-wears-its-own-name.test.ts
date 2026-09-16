/**
 * Nothing on an installation advertises the product it was built from.
 *
 * `SiteName` and `useSiteInitials` fixed six screens that had spelled the
 * product's name into their markup, and the admin rail's square has read the
 * operator's `site_name` ever since - "Acme Games" gives AG. Three things
 * were missed, and each is somewhere the operator cannot reach:
 *
 *   - `public/manifest.json` carried the product's name, short name and
 *     description as literals. That is what a phone shows when somebody adds
 *     the site to their home screen, so every installation on earth put the
 *     same word under the same icon.
 *   - There was no site logo setting at all. An operator could name their
 *     site but not put a mark on it, which is why the rail had only initials
 *     to draw.
 *   - `public/logo.png` was 48 KB of the product's own mark that nothing
 *     referenced.
 *
 * The browser tab icon stays a file. Next resolves `src/app/icon.svg` by
 * convention at build time, and an installation that wants its own replaces
 * the file; making it a route would cost a request on every page for
 * something almost nobody changes.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SITE_LOGO_KEY } from "@/core/lib/site-logo";

const ROOT = process.cwd();

describe("what an installation calls itself", () => {
    it("names the product in no manifest literal", () => {
        const dynamic = path.join(ROOT, "src/app/manifest.ts");
        expect(fs.existsSync(dynamic), "the manifest should be built from the settings").toBe(true);
        const source = fs.readFileSync(dynamic, "utf8");
        expect(source).toContain("site_name");
        expect(source, "a manifest with the product's name baked in is not the operator's")
            .not.toMatch(/["']Blysis["']/);
        expect(
            fs.existsSync(path.join(ROOT, "public/manifest.json")),
            "the static file would win over the route",
        ).toBe(false);
    });

    it("offers a logo the operator can set", () => {
        expect(SITE_LOGO_KEY).toBe("site_logo");
        const screen = fs.readFileSync(
            path.join(ROOT, "src/app/[locale]/(admin)/admin/settings/site/page.tsx"),
            "utf8",
        );
        // Through the constant, so the key has one spelling.
        expect(screen).toContain("SITE_LOGO_KEY");
        expect(screen).not.toMatch(/["']site_logo["']/);
        // The one image control, so a logo can be uploaded or linked.
        expect(screen).toContain("<UrlOrFile");
    });

    it("draws that logo where the initials used to stand alone", () => {
        const rail = fs.readFileSync(
            path.join(ROOT, "src/core/components/admin/AdminSidebar.tsx"),
            "utf8",
        );
        expect(rail).toContain("siteLogo");
        // The initials stay as the fallback: an install with no logo still
        // has something in the square.
        expect(rail).toContain("siteInitials");
    });

    it("ships no mark nothing draws", () => {
        expect(
            fs.existsSync(path.join(ROOT, "public/logo.png")),
            "48 KB of the product's own logo that nothing referenced",
        ).toBe(false);
    });
});
