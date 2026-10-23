/**
 * A visitor reads the site's name, never the software's.
 *
 * The register page told every visitor "Get started with Blysis", in all
 * twelve languages, on a site that was somebody's game server called
 * something else; the store's cart told them their checkout was "powered by
 * Blysis", which is neither the name they came for nor true of the payment,
 * which a gateway takes. An operator could not change either line short of
 * overriding a translation key they had no reason to know existed.
 *
 * What a visitor can be shown is everything outside the admin namespaces.
 * The two exceptions are written down below with why.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { locales } from "@/core/lib/i18n/config";

const ROOT = join(__dirname, "../..");
const PRODUCT = /blysis/i;

const ALLOWED: Record<string, string> = {
    // The fallback a site shows only while it has no name of its own yet.
    "common.appName": "read by site-name.tsx and manifest.ts when site_name is empty",
};

// The first-run wizard is read by the operator installing the software.
const OPERATOR_NAMESPACES = new Set(["admin", "setup"]);

function strings(tree: unknown, prefix = ""): [string, string][] {
    if (typeof tree === "string") return [[prefix, tree]];
    if (!tree || typeof tree !== "object") return [];
    return Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) =>
        strings(value, prefix ? `${prefix}.${key}` : key),
    );
}

function visitorLines(catalogue: Record<string, unknown>): [string, string][] {
    return Object.entries(catalogue)
        .filter(([namespace]) => !OPERATOR_NAMESPACES.has(namespace))
        .flatMap(([namespace, tree]) => strings(tree, namespace))
        .filter(([key]) => !(key in ALLOWED));
}

describe("a visitor is not told which platform runs the site", () => {
    it("core says nothing about Blysis on a visitor's screen", () => {
        const offenders: string[] = [];
        for (const locale of locales) {
            const catalogue = JSON.parse(readFileSync(join(ROOT, "messages-core", `${locale}.json`), "utf8"));
            for (const [key, text] of visitorLines(catalogue)) {
                if (PRODUCT.test(text)) offenders.push(`${locale} ${key}: ${text}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it("no module says it either", () => {
        const dirs = readdirSync(join(ROOT, "module-sources"), { withFileTypes: true }).filter((d) => d.isDirectory());
        expect(dirs.length).toBeGreaterThan(0);
        const offenders: string[] = [];
        for (const dir of dirs) {
            const manifest = JSON.parse(readFileSync(join(ROOT, "module-sources", dir.name, "module.json"), "utf8"));
            for (const [locale, catalogue] of Object.entries(manifest.translations ?? {})) {
                for (const [key, text] of visitorLines(catalogue as Record<string, unknown>)) {
                    if (PRODUCT.test(text)) offenders.push(`${dir.name} ${locale} ${key}: ${text}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("every exception names a key that exists", () => {
        const catalogue = JSON.parse(readFileSync(join(ROOT, "messages-core", "en.json"), "utf8"));
        const keys = new Set(strings(catalogue).map(([key]) => key));
        for (const key of Object.keys(ALLOWED)) expect(keys.has(key)).toBe(true);
    });
});
