import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Every row on the moderation screen is named, in both languages.
 *
 * The screen lists what a module declares it can hold back. Four rows were
 * named and the fifth read "Suggestion comments" in the middle of a Turkish
 * page with no description under it - not because the string was missing, but
 * because the module had put it in its own public namespace while the screen
 * reads `admin`, so the lookup missed and the manifest's English label was
 * printed instead.
 *
 * The other four were named because core's own catalogue carried them: core
 * knew the words "blog comments", "forum topics", "forum replies" and
 * "suggestions". That is the rule in section 5 from the other side - the core
 * ships empty and names no module - and it is why the fifth was the odd one
 * out rather than the only one done wrong.
 *
 * So the strings live with the module that declares the row, in the namespace
 * the screen reads, and the fallback that hid this is checked here instead of
 * on the page.
 */

const ROOT = process.cwd();
const MODULES = path.join(ROOT, "module-sources");

interface Provider {
    id: string;
    settingKey?: string;
    settingLabelKey?: string;
    settingDescKey?: string;
}

interface Manifest {
    moderationProviders?: Provider[];
    translations?: Record<string, Record<string, Record<string, string>>>;
}

function declared(): { module: string; provider: Provider; manifest: Manifest }[] {
    const out: { module: string; provider: Provider; manifest: Manifest }[] = [];
    for (const id of fs.readdirSync(MODULES)) {
        const file = path.join(MODULES, id, "module.json");
        if (!fs.existsSync(file)) continue;
        const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
        for (const provider of manifest.moderationProviders ?? []) {
            out.push({ module: id, provider, manifest });
        }
    }
    return out;
}

function coreAdmin(locale: string): Record<string, string> {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8"));
    return (data.admin ?? {}) as Record<string, string>;
}

describe("a moderation setting", () => {
    const rows = declared();

    it("finds the providers, so a broken scan cannot pass quietly", () => {
        expect(rows.length).toBeGreaterThan(3);
    });

    it("is named and described by the module that declares it, in both languages", () => {
        const unnamed: string[] = [];
        for (const { module, provider, manifest } of rows) {
            if (!provider.settingKey) continue;
            for (const locale of ["en", "tr"]) {
                const admin = manifest.translations?.[locale]?.admin ?? {};
                for (const key of [provider.settingLabelKey, provider.settingDescKey]) {
                    if (!key) {
                        unnamed.push(`${module}/${provider.id}: declares no key for one of its strings`);
                        continue;
                    }
                    // The screen reads one namespace. A string anywhere else
                    // is a string it cannot find.
                    if (typeof admin[key] !== "string") {
                        unnamed.push(`${module}/${provider.id} ${locale}: admin.${key}`);
                    }
                }
            }
        }
        expect(unnamed).toEqual([]);
    });

    it("is not named by core, which knows no module", () => {
        const named: string[] = [];
        for (const { provider } of rows) {
            for (const locale of ["en", "tr"]) {
                const admin = coreAdmin(locale);
                for (const key of [provider.settingLabelKey, provider.settingDescKey]) {
                    if (key && key in admin) named.push(`${locale}: admin.${key}`);
                }
            }
        }
        expect(named).toEqual([]);
    });

    it("shows a mode in words rather than the value it stores", () => {
        // The badge printed the column: AUTO and MANUAL, in a monospace face,
        // on a screen an operator reads.
        const screen = fs.readFileSync(
            path.join(ROOT, "src/app/[locale]/(admin)/admin/settings/moderation/page.tsx"),
            "utf8",
        );
        expect(screen).toContain("moderationSettings_manual");
        expect(screen).toContain("moderationSettings_auto");
        expect(screen).not.toMatch(/\{config\[field\.settingKey\]\}/);
    });
});
