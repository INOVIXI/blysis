import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { emitThemeFontsTs } from "../../scripts/lib/theme-fonts";
import type { ThemeManifest } from "@/core/lib/theme-manifest-schema";

/**
 * A theme can bring the typefaces its look is drawn in.
 *
 * The layout self-hosts three families through `next/font/google`, and a
 * theme could only name those or whatever the visitor's computer had. A
 * site served from `http://<ip>:<port>` cannot count on a font CDN either.
 * So a theme ships its font files and the generator writes one
 * `next/font/local` call per family, which self-hosts them the way the
 * layout's own fonts are, with a fallback whose metrics are adjusted so the
 * swap does not move the page.
 *
 * `preload` is off: every installed theme's fonts are compiled in, and a
 * site wearing one theme should not download another's on every first visit.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

function theme(id: string, fontFiles?: ThemeManifest["fontFiles"]): ThemeManifest {
    return {
        schemaVersion: 2,
        id,
        name: id,
        description: "",
        version: "1.0.0",
        modes: { default: "light", available: { light: { tokens: {} } } },
        tokens: {},
        fontFiles,
    } as ThemeManifest;
}

describe("a theme's font files", () => {
    it("become one local font per family, published under the theme's own variable", () => {
        const out = emitThemeFontsTs(
            { vanguard: theme("vanguard", { heading: [{ file: "fonts/Heading-Bold.woff2", weight: "700", style: "normal" }] }) },
            () => true,
        );
        expect(out).toContain('import localFont from "next/font/local";');
        expect(out).toContain('"../../themes/vanguard/fonts/Heading-Bold.woff2"');
        expect(out).toContain('variable: "--font-vanguard-heading"');
        expect(out).toContain('weight: "700"');
        expect(out).toContain("preload: false");
        expect(out).toMatch(/export const themeFontVariables: string = \[[^\]]+\.variable\]\.join\(" "\);/);
    });

    it("skips a family whose file is missing, rather than failing the build", () => {
        const out = emitThemeFontsTs(
            { vanguard: theme("vanguard", { heading: [{ file: "fonts/Gone.woff2", weight: "700", style: "normal" }] }) },
            () => false,
        );
        expect(out).not.toContain("localFont(");
        expect(out).toContain('export const themeFontVariables: string = "";');
    });

    it("writes no font import at all when no theme brings a font", () => {
        const out = emitThemeFontsTs({ flat: theme("flat") }, () => true);
        expect(out).not.toContain("next/font/local");
        expect(out).toContain('export const themeFontVariables: string = "";');
    });

    it("keeps two themes' families apart", () => {
        const out = emitThemeFontsTs(
            {
                a: theme("a", { body: [{ file: "fonts/A.woff2", weight: "400", style: "normal" }] }),
                b: theme("b", { body: [{ file: "fonts/B.woff2", weight: "400", style: "normal" }] }),
            },
            () => true,
        );
        expect(out).toContain('variable: "--font-a-body"');
        expect(out).toContain('variable: "--font-b-body"');
    });
});

describe("the layout", () => {
    it("publishes the themes' font variables on html, where the tokens can read them", () => {
        const layout = fs.readFileSync(path.join(ROOT, "src/app/[locale]/layout.tsx"), "utf8");
        const html = [...layout.matchAll(/<html\b[^>]*>/g)].find((m) => m[0].includes("{locale}"));
        expect(html, "the layout should render an html element").toBeTruthy();
        expect(html![0]).toContain("themeFontVariables");
    });
});
