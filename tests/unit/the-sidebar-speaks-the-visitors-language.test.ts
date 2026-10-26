/**
 * A module's sidebar entry is named in the reader's language.
 *
 * A module contributes `menu: [{ label: "Payment Settings", path: ... }]`,
 * and `buildNavGroups` looks that entry up as `admin.menu_<module>_<label>`
 * with the manifest's English label as the fallback. The fallback is the
 * whole problem: a module that forgets the key renders English in the middle
 * of a Turkish sidebar and nothing fails, because the fallback is doing
 * exactly what it was written to do.
 *
 * The key is derived, not declared, so a module cannot get it wrong by
 * spelling it differently - it can only leave it out. This says so.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { locales } from "@/core/lib/i18n/config";
import { CORE_NAV_GROUPS, buildThemeNavGroup } from "@/core/lib/admin-nav-groups";

const ROOT = join(__dirname, "../..");
const SOURCES = join(ROOT, "module-sources");

interface Manifest {
    menu?: { label: string; path: string; group?: string; section?: string }[];
    navGroups?: { id: string; label: string }[];
    translations?: Record<string, Record<string, Record<string, string>>>;
}

/** The key `buildNavGroups` asks for. Kept in step with it by the test below. */
function labelKey(moduleId: string, label: string): string {
    return `menu_${moduleId}_${label.replace(/\s+/g, "_").toLowerCase()}`;
}

function manifests(): { id: string; manifest: Manifest }[] {
    if (!existsSync(SOURCES)) return [];
    return readdirSync(SOURCES, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(SOURCES, e.name, "module.json")))
        .map((e) => ({
            id: e.name,
            manifest: JSON.parse(readFileSync(join(SOURCES, e.name, "module.json"), "utf-8")) as Manifest,
        }));
}

describe("a module menu entry", () => {
    const withMenus = manifests().filter((m) => (m.manifest.menu ?? []).length > 0);

    it("is a thing modules actually do", () => {
        expect(withMenus.length).toBeGreaterThan(30);
    });

    it("declares its label in every locale core ships", () => {
        const missing: string[] = [];
        for (const { id, manifest } of withMenus) {
            for (const locale of locales) {
                const admin = manifest.translations?.[locale]?.admin ?? {};
                for (const entry of manifest.menu ?? []) {
                    const key = labelKey(id, entry.label);
                    if (!admin[key]) missing.push(`${id}/${locale}: admin.${key} ("${entry.label}")`);
                }
                // Several entries render under a header naming the module.
                if ((manifest.menu ?? []).length > 1 && !admin[`menu_${id}`]) {
                    missing.push(`${id}/${locale}: admin.menu_${id}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it("names a group that something declares", () => {
        // An item whose group nothing provides lands in a catch-all drawer,
        // which is a page an operator finds by accident or not at all.
        //
        // Core's ids are read from core rather than copied here: the copy
        // that used to stand in this line outlived two of the groups it named.
        const declared = new Set(CORE_NAV_GROUPS.map((g) => g.id));
        for (const { manifest } of manifests()) {
            for (const group of manifest.navGroups ?? []) declared.add(group.id);
        }
        const orphans: string[] = [];
        for (const { id, manifest } of withMenus) {
            for (const entry of manifest.menu ?? []) {
                if (!entry.group) orphans.push(`${id}: ${entry.path} names no group`);
                else if (!declared.has(entry.group)) orphans.push(`${id}: ${entry.path} -> ${entry.group}`);
            }
        }
        expect(orphans).toEqual([]);
    });

    it("names a section with a heading over it", () => {
        // Two ways to have one: join a section core ships, which carries its
        // own heading, or name a new one and let core's `navSection_<id>` say
        // what it is called. A slug with neither renders as the slug itself -
        // "payments", lower case and in English, over fourteen providers.
        const coreSectionIds = new Set(
            CORE_NAV_GROUPS.flatMap((g) => g.sections.map((s) => s.id)).filter(Boolean),
        );
        const missing: string[] = [];
        for (const locale of locales) {
            const admin = JSON.parse(readFileSync(join(ROOT, `messages-core/${locale}.json`), "utf-8")).admin;
            for (const { id, manifest } of withMenus) {
                for (const entry of manifest.menu ?? []) {
                    if (!entry.section) continue;
                    if (coreSectionIds.has(entry.section)) continue;
                    if (!admin[`navSection_${entry.section}`]) {
                        missing.push(`${id}/${locale}: admin.navSection_${entry.section}`);
                    }
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it("declares the label of any group it invents", () => {
        const missing: string[] = [];
        for (const { id, manifest } of manifests()) {
            for (const group of manifest.navGroups ?? []) {
                for (const locale of locales) {
                    const admin = manifest.translations?.[locale]?.admin ?? {};
                    if (!admin[`navGroup_${group.id}`]) {
                        missing.push(`${id}/${locale}: admin.navGroup_${group.id} ("${group.label}")`);
                    }
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it("derives its key the way the sidebar looks it up", () => {
        // If `buildNavGroups` changes its convention, the check above starts
        // passing while every label goes back to English. This is the pin.
        const source = readFileSync(join(ROOT, "src/core/lib/admin-nav-groups.ts"), "utf-8");
        expect(source).toContain("`menu_${mod.id}_${entry.label.replace(/\\s+/g, \"_\").toLowerCase()}`");
        expect(source).toContain("`menu_${mod.id}`");
        expect(source).toContain("`navGroup_${declaration.id}`");
    });
});

describe("a theme's own sidebar entries", () => {
    /*
     * The theme group lists the active theme's settings screens, and each
     * entry carried only the English label from its manifest: a Turkish panel
     * read "Numbers row" and "Sign-in screen" beside Turkish screens, and the
     * Appearance entry above them was written in English in core. Each now
     * carries the key the theme already declares for that screen.
     */
    const THEMES = join(ROOT, "src/themes");
    const themes = readdirSync(THEMES).filter((id) => existsSync(join(THEMES, id, "theme.json")));
    const core = (locale: string) => JSON.parse(readFileSync(join(ROOT, "messages-core", `${locale}.json`), "utf-8")).admin ?? {};

    it("is read from at least one theme", () => {
        expect(themes.length).toBeGreaterThan(0);
    });

    it("is named in every locale, from the theme's strings or core's", () => {
        const missing: string[] = [];
        for (const id of themes) {
            const theme = JSON.parse(readFileSync(join(THEMES, id, "theme.json"), "utf-8")) as Manifest;
            const items = buildThemeNavGroup(id)?.sections.flatMap((s) => s.items) ?? [];
            expect(items.length, id).toBeGreaterThan(0);
            for (const item of items) {
                if (!item.labelKey) {
                    missing.push(`${id}: ${item.label} has no key`);
                    continue;
                }
                for (const locale of locales) {
                    if (!theme.translations?.[locale]?.admin?.[item.labelKey] && !core(locale)[item.labelKey]) {
                        missing.push(`${id}/${locale}: admin.${item.labelKey}`);
                    }
                }
            }
        }
        expect(missing).toEqual([]);
    });
});
