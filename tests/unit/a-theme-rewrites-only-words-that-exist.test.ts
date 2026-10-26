/**
 * A theme may word the site in its own voice, and only the site's words.
 *
 * The active theme's strings speak over core's and every module's, so a theme
 * can call the shop "Pazar yeri" everywhere it is named. That reach is why
 * each such string is checked here: one that names a key nothing ships is a
 * typo nobody reads, and one that asks for a value the calling code never
 * passes breaks the page it lands on, exactly as an operator's edit would.
 * The edit check is the one the translation editor uses.
 *
 * A theme's own namespace and its panel labels (`admin.theme_<id>_*`) are its
 * own words, and are checked by the gates that read those.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { locales } from "@/core/lib/i18n/config";
import { messageAt } from "@/core/lib/i18n/shipped-messages";
import { checkMessageEdit } from "@/core/lib/message-edit";

const ROOT = process.cwd();
const THEMES = path.join(ROOT, "src/themes");
const MODULES = path.join(ROOT, "module-sources");

type Catalogue = Record<string, Record<string, unknown>>;

function shippedCatalogues(locale: string): Catalogue[] {
    const core = JSON.parse(fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8")) as Catalogue;
    const modules = fs.readdirSync(MODULES)
        .map((id) => path.join(MODULES, id, "module.json"))
        .filter((file) => fs.existsSync(file))
        .map((file) => (JSON.parse(fs.readFileSync(file, "utf8")).translations?.[locale] ?? {}) as Catalogue);
    return [core, ...modules];
}

const CATALOGUES = new Map<string, Catalogue[]>(locales.map((locale) => [locale, shippedCatalogues(locale)]));

function shipped(locale: string, namespace: string, key: string): string | null {
    for (const catalogue of CATALOGUES.get(locale) ?? []) {
        const ns = Object.prototype.hasOwnProperty.call(catalogue, namespace) ? catalogue[namespace] : undefined;
        if (!ns || typeof ns !== "object") continue;
        const found = messageAt(ns as Record<string, unknown>, key);
        if (found !== null) return found;
    }
    return null;
}

function leaves(tree: Record<string, unknown>, prefix = ""): [string, string][] {
    return Object.entries(tree).flatMap(([name, value]) => {
        const key = prefix ? `${prefix}.${name}` : name;
        if (typeof value === "string") return [[key, value] as [string, string]];
        return value && typeof value === "object" ? leaves(value as Record<string, unknown>, key) : [];
    });
}

interface Rewrite {
    locale: string;
    namespace: string;
    key: string;
}

/** Every string a theme words that is not its own, and what is wrong with each. */
function rewrites(id: string, translations: Record<string, Catalogue>): { checked: Rewrite[]; problems: string[] } {
    const checked: Rewrite[] = [];
    const problems: string[] = [];
    for (const [locale, namespaces] of Object.entries(translations)) {
        for (const [namespace, tree] of Object.entries(namespaces)) {
            if (namespace === id || !tree || typeof tree !== "object") continue;
            for (const [key, value] of leaves(tree)) {
                if (namespace === "admin" && key.startsWith(`theme_${id}_`)) continue;
                checked.push({ locale, namespace, key });
                const original = shipped(locale, namespace, key);
                if (original === null) {
                    problems.push(`${id} ${locale}: ${namespace}.${key} rewrites a string nothing ships`);
                    continue;
                }
                const refusal = checkMessageEdit(original, value);
                if (refusal) problems.push(`${id} ${locale}: ${namespace}.${key} is refused (${refusal.reason}${refusal.names ? `: ${refusal.names.join(", ")}` : ""})`);
            }
        }
    }
    return { checked, problems };
}

const THEME_IDS = fs.readdirSync(THEMES).filter((id) => fs.existsSync(path.join(THEMES, id, "theme.json")));

describe("a theme rewrites only words that exist", () => {
    it("reads every theme in the tree", () => {
        expect(THEME_IDS.length).toBeGreaterThan(1);
    });

    for (const id of THEME_IDS) {
        it(`${id} words only strings the site ships, asking for nothing new`, () => {
            const manifest = JSON.parse(fs.readFileSync(path.join(THEMES, id, "theme.json"), "utf8"));
            expect(rewrites(id, manifest.translations ?? {}).problems).toEqual([]);
        });
    }

    it("sees a misspelt key and a value the code never passes", () => {
        const { checked, problems } = rewrites("fixture", {
            tr: {
                fixture: { ownWords: "Bizim" },
                admin: { theme_fixture_label: "Etiket" },
                store: { titel: "Pazar yeri", title: "{count} pazar" },
            },
        });
        expect(checked.map((r) => r.key)).toEqual(["titel", "title"]);
        expect(problems).toEqual([
            "fixture tr: store.titel rewrites a string nothing ships",
            "fixture tr: store.title is refused (new_placeholder: count)",
        ]);
    });
});
