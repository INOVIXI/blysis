/**
 * Every head service this module offers is asked by the member's name.
 *
 * Each address was checked by hand to answer a name with a PNG when the
 * module was written. Services that answer only a UUID (Crafatar) or refused
 * names (Visage) are left out: core asks by name, and they would draw nobody.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { moduleManifestSchema } from "@/core/lib/module-manifest-schema";
import { avatarProvidersOf } from "@/core/lib/avatar-providers";
import { providerFaceUrl } from "@/core/lib/member-face";

const raw = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../../module-sources/minecraft-heads/module.json"), "utf8"),
) as Record<string, unknown>;

const parsed = moduleManifestSchema.safeParse(raw);

describe("the minecraft-heads manifest", () => {
    it("is a valid manifest", () => {
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it("needs a core that understands avatar providers", () => {
        expect(parsed.data?.coreVersion).toBe("^5.35.0");
    });

    it("asks each service for a member's head by name and size", () => {
        const providers = avatarProvidersOf([{ moduleName: "minecraft-heads", manifest: parsed.data! }]);
        const urls = Object.fromEntries(providers.map((p) => [p.id, providerFaceUrl(p.url, "Notch", 32)]));
        expect(urls).toEqual({
            "minecraft-heads.cravatar": "https://cravatar.eu/helmavatar/Notch/64.png",
            "minecraft-heads.mc-heads": "https://mc-heads.net/avatar/Notch/64",
            "minecraft-heads.mineskin": "https://mineskin.eu/helm/Notch/64",
            "minecraft-heads.minotar": "https://minotar.net/helm/Notch/64",
        });
    });

    it("names every service, and itself, in every language the site speaks", () => {
        const translations = parsed.data!.translations as Record<string, { admin: Record<string, string> }>;
        const locales = Object.keys(translations);
        expect(locales.sort()).toEqual(["az", "de", "en", "es", "et", "fr", "it", "pl", "pt", "ru", "tr", "zh"]);
        const wanted = [
            "module_minecraft-heads_name",
            "module_minecraft-heads_description",
            ...parsed.data!.avatarProviders!.map((p) => p.labelKey),
        ];
        for (const locale of locales) {
            for (const key of wanted) {
                expect(translations[locale].admin[key], `${locale}: ${key}`).toBeTruthy();
            }
        }
    });
});
