/**
 * Nothing on an installation advertises the product it was built from.
 *
 * `SiteName` and `useSiteLogo` fixed six screens that had spelled the
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
 * The browser tab icon was a file, `src/app/icon.svg` with `favicon.ico` and
 * `apple-icon.png` beside it, so the only way to change it was to edit the
 * installation's source, which an operator never does. It is a setting now,
 * `site_icon`, and the shipped icons are what the head links to while it is
 * unset. They live in `public/`: Next lets an icon file in `src/app` win over
 * the icons a layout's metadata names, so left there they would have hidden
 * the setting on every page.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SITE_ICON_KEY, SITE_LOGO_KEY, siteIconMetadata } from "@/core/lib/site-logo";

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

    it("draws one mark, in every place a mark belongs", () => {
        // The rail, the public bar and the footer. The logo was written out
        // twice with two different fallbacks - initials in the rail, a house
        // icon and the word "home" in the bar - and the footer had none at
        // all, so an operator who uploaded a logo saw it in one of the three
        // places it belongs.
        const mark = fs.readFileSync(path.join(ROOT, "src/core/components/ui/site-name.tsx"), "utf8");
        expect(mark).toContain("export function SiteMark");
        // The fallback is the icon the installation already ships and a
        // browser already shows in its tab.
        expect(mark).toContain('"/icon.svg"');
        expect(mark).not.toContain("useSiteInitials");

        for (const file of [
            "src/core/components/admin/AdminSidebar.tsx",
            "src/core/components/layout/Navbar.tsx",
            "src/core/components/layout/Footer.tsx",
        ]) {
            expect(fs.readFileSync(path.join(ROOT, file), "utf8"), file).toContain("<SiteMark");
        }
    });

    it("offers a tab icon the operator can set", () => {
        expect(SITE_ICON_KEY).toBe("site_icon");
        const screen = fs.readFileSync(
            path.join(ROOT, "src/app/[locale]/(admin)/admin/settings/site/page.tsx"),
            "utf8",
        );
        expect(screen).toContain("SITE_ICON_KEY");
        expect(screen.match(/<UrlOrFile/g)?.length).toBe(2);
    });

    it("puts the operator's icon in the tab and on the home screen", () => {
        expect(siteIconMetadata(" /uploads/icon.png ")).toEqual({
            icon: [{ url: "/uploads/icon.png" }],
            apple: [{ url: "/uploads/icon.png" }],
        });
    });

    it("keeps the shipped icons while none is set", () => {
        for (const unset of [undefined, null, "", "   ", 42]) {
            expect(siteIconMetadata(unset)).toEqual({
                icon: [
                    { url: "/favicon.ico", sizes: "any" },
                    { url: "/icon.svg", type: "image/svg+xml" },
                ],
                apple: [{ url: "/apple-icon.png" }],
            });
        }
        for (const file of ["favicon.ico", "icon.svg", "apple-icon.png"]) {
            expect(fs.existsSync(path.join(ROOT, "public", file)), `public/${file}`).toBe(true);
            // A file convention in src/app outranks the layout's `icons`.
            expect(fs.existsSync(path.join(ROOT, "src/app", file)), `src/app/${file}`).toBe(false);
        }
        const layout = fs.readFileSync(path.join(ROOT, "src/app/[locale]/layout.tsx"), "utf8");
        expect(layout).toContain("icons: siteIconMetadata(");
    });

    it("ships no mark nothing draws", () => {
        expect(
            fs.existsSync(path.join(ROOT, "public/logo.png")),
            "48 KB of the product's own logo that nothing referenced",
        ).toBe(false);
    });
});

/**
 * The name it used to wear does not come back.
 *
 * The product was uxwVend until 2026-09-11. The source was swept then, but a
 * name lives in more places than a rename touches: on 2026-09-21 the demo
 * database still had seven queued emails subjected "uxwVend: too many failed
 * sign-in attempts" and a manual payment instruction reading "Account name:
 * uxwVend Ltd". Neither came from the code - the subject is "{app}: ..."
 * rendered against the site's own name setting, and the instruction is
 * something an operator typed - so both were data, and both were corrected.
 *
 * This is the half that can be held: nothing in the tree says it again. A
 * screen, a seed or a sample that reintroduces the old name would put it back
 * into the next installation's database, where it is hard to find.
 */
describe("the name the product used to have", () => {
    it("is nowhere in the tree", () => {
        const OLD = /uxwVend|uxw-vend|uxwvend/i;
        const offenders: string[] = [];

        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { walk(full); continue; }
                if (!/\.(ts|tsx|json|md|css|sh|sql)$/.test(entry.name)) continue;
                const text = fs.readFileSync(full, "utf8");
                for (const [index, line] of text.split("\n").entries()) {
                    // The test naming itself, and the repository's own path on
                    // the box it is developed on, are not the product's name.
                    if (!OLD.test(line)) continue;
                    if (full.endsWith("an-installation-wears-its-own-name.test.ts")) continue;
                    offenders.push(`${path.relative(ROOT, full)}:${index + 1}`);
                }
            }
        };
        for (const dir of ["src", "module-sources", "messages-core", "prisma"]) {
            walk(path.join(ROOT, dir));
        }

        expect(offenders).toEqual([]);
    });
});
