/**
 * Every colour a theme lets an admin change is named in the panel's language.
 *
 * The appearance screen listed a theme's colours by their token names:
 * `primaryForeground`, `mutedForeground`, `stageMuted`, on a Turkish panel
 * as on every other. The names every theme shares are core's words; a
 * colour only one theme has is that theme's, and it says which key names it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { locales } from "@/core/lib/i18n/config";
import { colorLabelKey } from "@/core/lib/theme-labels";

const ROOT = join(__dirname, "../..");
const THEMES = join(ROOT, "src/themes");

interface ThemeManifest {
    tokens?: { colors?: Record<string, { labelKey?: string }> };
    translations?: Record<string, Record<string, Record<string, string>>>;
}

const themes = readdirSync(THEMES)
    .filter((id) => existsSync(join(THEMES, id, "theme.json")))
    .map((id) => ({ id, manifest: JSON.parse(readFileSync(join(THEMES, id, "theme.json"), "utf8")) as ThemeManifest }));

function coreAdmin(locale: string): Record<string, string> {
    return JSON.parse(readFileSync(join(ROOT, "messages-core", `${locale}.json`), "utf8")).admin ?? {};
}

function unnamed(theme: { id: string; manifest: ThemeManifest }): string[] {
    const missing: string[] = [];
    for (const locale of locales) {
        const own = theme.manifest.translations?.[locale]?.admin ?? {};
        const core = coreAdmin(locale);
        for (const [name, def] of Object.entries(theme.manifest.tokens?.colors ?? {})) {
            const key = colorLabelKey(name, def.labelKey);
            if (!own[key] && !core[key]) missing.push(`${theme.id} ${locale}: ${name} (${key})`);
        }
    }
    return missing;
}

describe("a theme's colours", () => {
    it("are read from every theme, and every theme has some", () => {
        expect(themes.length).toBeGreaterThan(0);
        for (const theme of themes) expect(Object.keys(theme.manifest.tokens?.colors ?? {}).length, theme.id).toBeGreaterThan(0);
    });

    it("are each named by a key every locale translates", () => {
        expect(themes.flatMap(unnamed)).toEqual([]);
    });

    it("would say so for a colour of a theme's own that names no key", () => {
        const fixture = { id: "fixture", manifest: { tokens: { colors: { primary: {}, glow: {} } } } };
        expect(unnamed(fixture).filter((line) => line.startsWith("fixture en:"))).toEqual(["fixture en: glow (theme_color_glow)"]);
    });
});
