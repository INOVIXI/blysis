/**
 * Every section of a member's account is named in the language they read in.
 *
 * A module contributes a section to the profile page and gives it a `label`
 * in its manifest, which is English prose. That label was only ever a
 * fallback: the name a reader saw came from `profileTab_<id>` in *core's* own
 * message file. Four of the nine tabs had one. The other five - Trophies,
 * Credits, Minecraft, Licenses, Accounts - printed their English label to a
 * Turkish reader, which nobody noticed while the sections were behind a strip
 * that scrolled most of them off the right edge.
 *
 * It was also the wrong place for them. Core naming `ProfileOrdersTab` is
 * core knowing the shop exists. A module ships its own translations, so the
 * name belongs there, and `labelKey` is how a tab points at it.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCES = path.join(ROOT, "module-sources");

interface Manifest {
    id: string;
    profileTabs?: { id: string; label: string; labelKey?: string }[];
    translations?: Record<string, Record<string, Record<string, string>>>;
}

function manifests(): Manifest[] {
    return fs
        .readdirSync(SOURCES, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(SOURCES, e.name, "module.json")))
        .map((e) => JSON.parse(fs.readFileSync(path.join(SOURCES, e.name, "module.json"), "utf8")) as Manifest)
        .filter((m) => (m.profileTabs?.length ?? 0) > 0);
}

/** `trophies.profileTab` against the module's own `translations` block. */
function says(manifest: Manifest, locale: string, key: string): string | undefined {
    const dot = key.indexOf(".");
    if (dot < 0) return undefined;
    return manifest.translations?.[locale]?.[key.slice(0, dot)]?.[key.slice(dot + 1)];
}

describe("a profile section a module contributes", () => {
    const withTabs = manifests();

    it("finds modules to check, so a broken scan cannot pass quietly", () => {
        expect(withTabs.length).toBeGreaterThan(5);
    });

    it("points at a name of its own rather than leaning on core", () => {
        const unnamed: string[] = [];
        for (const manifest of withTabs) {
            for (const tab of manifest.profileTabs ?? []) {
                if (!tab.labelKey) unnamed.push(`${manifest.id}/${tab.id}`);
            }
        }
        expect(unnamed, "every profileTabs entry needs a labelKey").toEqual([]);
    });

    it("carries that name in both languages", () => {
        const missing: string[] = [];
        for (const manifest of withTabs) {
            for (const tab of manifest.profileTabs ?? []) {
                if (!tab.labelKey) continue;
                for (const locale of ["en", "tr"]) {
                    if (!says(manifest, locale, tab.labelKey)) {
                        missing.push(`${manifest.id}/${tab.id} has no ${locale} ${tab.labelKey}`);
                    }
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it("leaves core with no knowledge of which module contributed one", () => {
        for (const locale of ["en", "tr"]) {
            const messages = JSON.parse(
                fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8"),
            ) as { profile: Record<string, string> };
            const named = Object.keys(messages.profile).filter((k) => k.startsWith("profileTab_"));
            expect(named, `${locale} still names module tabs in core`).toEqual([]);
        }
    });
});
