// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A theme's settings screen is in the reader's language.
 *
 * The manifest carries a `translations` block and always has - but nothing
 * seeded it, and a field's label could not point at it: `SchemaForm` reads
 * `def.label ?? fieldKey`, a literal typed by the theme's author, or failing
 * that the column name. So every label on every theme settings screen was
 * whatever English the author wrote, and on the hero screen a Turkish
 * operator read "Show hero on homepage", "Button text", "Background image
 * (optional)" - with the site's own chrome in Turkish around them.
 *
 * This is the shape modules already use and it is worth naming: a `labelKey`
 * beside the literal, the theme shipping the string in every locale the site
 * serves, and the seeder writing those rows the way it writes a module's. The
 * literal stays as the fallback, because a theme somebody else wrote may
 * declare no key at all and still has to render something.
 */

const ROOT = path.resolve(__dirname, "../..");
const THEMES = path.join(ROOT, "src/themes");
const LOCALES = ["en", "tr"] as const;

interface Field { label?: string; labelKey?: string }
interface Group { label?: string; labelKey?: string; fields?: Record<string, Field> }
interface Manifest {
    id: string;
    settings?: Record<string, Group>;
    translations?: Record<string, Record<string, Record<string, string>>>;
}

function manifests(): Manifest[] {
    return fs.readdirSync(THEMES)
        .map((id) => path.join(THEMES, id, "theme.json"))
        .filter((file) => fs.existsSync(file))
        .map((file) => JSON.parse(fs.readFileSync(file, "utf8")) as Manifest);
}

describe("the theme contract", () => {
    const schema = fs.readFileSync(path.join(ROOT, "src/core/lib/theme-manifest-schema.ts"), "utf8");

    it("lets a field and a group name a string rather than carry one", () => {
        expect(schema).toContain("labelKey");
    });

    it("is read by the form, with the literal kept as the fallback", () => {
        const form = fs.readFileSync(
            path.join(ROOT, "src/core/components/admin/theme-settings/SchemaForm.tsx"),
            "utf8",
        );
        expect(form).toContain("labelKey");
        expect(form).not.toMatch(/const label = def\.label \?\? fieldKey;/);
    });
});

describe("every theme this repository ships", () => {
    const all = manifests();

    it("finds the themes, so a broken scan cannot pass quietly", () => {
        expect(all.length).toBeGreaterThan(0);
    });

    it("names every settings group and every field it offers", () => {
        const unnamed: string[] = [];
        for (const theme of all) {
            for (const [groupKey, group] of Object.entries(theme.settings ?? {})) {
                if (!group.labelKey) unnamed.push(`${theme.id}: group ${groupKey}`);
                for (const [fieldKey, field] of Object.entries(group.fields ?? {})) {
                    if (!field.labelKey) unnamed.push(`${theme.id}: ${groupKey}.${fieldKey}`);
                }
            }
        }
        expect(unnamed).toEqual([]);
    });

    it("ships each of those strings in every locale the site serves", () => {
        const missing: string[] = [];
        for (const theme of all) {
            const keys = new Set<string>();
            for (const group of Object.values(theme.settings ?? {})) {
                if (group.labelKey) keys.add(group.labelKey);
                for (const field of Object.values(group.fields ?? {})) {
                    if (field.labelKey) keys.add(field.labelKey);
                }
            }
            for (const locale of LOCALES) {
                const admin = theme.translations?.[locale]?.admin ?? {};
                for (const key of keys) {
                    if (typeof admin[key] !== "string" || !admin[key].trim()) {
                        missing.push(`${theme.id} ${locale}: admin.${key}`);
                    }
                }
            }
        }
        expect(missing).toEqual([]);
    });
});

describe("a theme's strings", () => {
    it("are seeded, or they are a block nothing ever reads", () => {
        const seeder = fs.readFileSync(path.join(ROOT, "scripts/seed-translations.ts"), "utf8");
        expect(seeder).toContain("themeRegistry");
    });
});
