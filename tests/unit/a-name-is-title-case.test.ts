import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A name is Title Case. A sentence is not.
 *
 * The notification grid read "Destek talebinize yanıt" and the credit history
 * read "Çark ödülü" - each one a *name* for a kind of thing, written as if it
 * were the middle of a sentence, sitting in a column of other names that were
 * capitalised. The page looked like two people had written it, because two
 * people had.
 *
 * So the rule is about the job a string does, not where it appears. A string
 * that names something - a kind of event, a kind of ledger entry, a tab, a
 * status - is Title Case. A string that says something - a description, an
 * error, a paragraph, a button that is a verb phrase - is written as prose
 * and is not covered here.
 *
 * Enforced over the catalogues where the job is known from the key. A name
 * that lives in the database instead (a trophy an operator renamed, a product
 * they added) is theirs and is not gated; the demo data this repo ships
 * follows the rule because it is an example of it.
 */

const ROOT = process.cwd();
const MODULES = path.join(ROOT, "module-sources");

/**
 * Key families whose values name a thing.
 *
 * Adding a family is how the rule grows. Each entry says which namespace and
 * which keys within it, so a catalogue of prose is never dragged in wholesale.
 */
const NAME_FAMILIES: { namespace: string; keys: RegExp; what: string }[] = [
    { namespace: "activity", keys: /^kind/, what: "a kind of activity" },
    { namespace: "profile", keys: /^notificationType_/, what: "a kind of notification" },
    { namespace: "credits", keys: /^type[A-Z]/, what: "a kind of ledger entry" },
    // `tab_orders_status` itself is the filter's label, which is a
    // question rather than a name; the five that follow it are the names.
    { namespace: "store", keys: /^tab_orders_status[A-Z]/, what: "an order status" },
];

/**
 * Words that stay lower-case inside a title, in the two active locales.
 *
 * Articles, conjunctions and short prepositions. A pronoun is not one of
 * them: "Your" is capitalised, which is why `your` is absent.
 */
const SMALL_WORDS = new Set([
    "a", "an", "and", "or", "the", "to", "of", "on", "in", "for", "with", "at", "by", "from", "into",
    "ve", "ile", "veya", "ya", "da", "de",
]);

/** The first letter of every word is upper case, but for the small words. */
export function isTitleCase(value: string): boolean {
    const words = value.trim().split(/\s+/).filter(Boolean);
    return words.every((word, index) => {
        // Leading punctuation and quotes are not the word.
        const bare = word.replace(/^[^\p{L}\p{N}]+/u, "");
        const first = [...bare][0];
        if (!first || !/\p{L}/u.test(first)) return true;
        if (index > 0 && SMALL_WORDS.has(bare.toLocaleLowerCase("tr"))) return true;
        return first === first.toLocaleUpperCase("tr");
    });
}

function catalogues(): { where: string; namespace: string; entries: Record<string, string> }[] {
    const out: { where: string; namespace: string; entries: Record<string, string> }[] = [];
    for (const locale of ["en", "tr"]) {
        const core = JSON.parse(fs.readFileSync(path.join(ROOT, `messages-core/${locale}.json`), "utf8"));
        for (const [namespace, entries] of Object.entries(core)) {
            if (entries && typeof entries === "object") {
                out.push({ where: `core ${locale}`, namespace, entries: entries as Record<string, string> });
            }
        }
        for (const id of fs.readdirSync(MODULES)) {
            const file = path.join(MODULES, id, "module.json");
            if (!fs.existsSync(file)) continue;
            const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
            for (const [namespace, entries] of Object.entries(manifest.translations?.[locale] ?? {})) {
                if (entries && typeof entries === "object") {
                    out.push({ where: `${id} ${locale}`, namespace, entries: entries as Record<string, string> });
                }
            }
        }
    }
    return out;
}

describe("a name is title case", () => {
    it("knows a name from a sentence", () => {
        expect(isTitleCase("Wheel Prize")).toBe(true);
        expect(isTitleCase("Çark Ödülü")).toBe(true);
        expect(isTitleCase("Credits Added to Your Balance")).toBe(true);
        expect(isTitleCase("Bought from a Member")).toBe(true);
        expect(isTitleCase("Wheel prize")).toBe(false);
        expect(isTitleCase("Destek talebinize yanıt")).toBe(false);
        // Turkish dotless i: `ısı` upper-cases to `ISI`, not `İSİ`.
        expect(isTitleCase("Isı Ayarı")).toBe(true);
    });

    it("finds the catalogues", () => {
        expect(catalogues().length).toBeGreaterThan(50);
    });

    it("writes every name as a name", () => {
        const wrong: string[] = [];
        for (const { where, namespace, entries } of catalogues()) {
            for (const family of NAME_FAMILIES) {
                if (namespace !== family.namespace) continue;
                for (const [key, value] of Object.entries(entries)) {
                    if (!family.keys.test(key) || typeof value !== "string") continue;
                    if (!isTitleCase(value)) wrong.push(`${where}: ${namespace}.${key} names ${family.what} - "${value}"`);
                }
            }
        }
        expect(wrong, wrong.join("\n")).toEqual([]);
    });

    it("names the demo data it ships the same way", () => {
        // A seeded trophy is an example of a trophy, and an operator reading
        // "Bug hunter" beside "Supporter" learns the wrong house style.
        const seed = fs.readFileSync(path.join(MODULES, "trophies", "seed.ts"), "utf8");
        const block = seed.slice(seed.indexOf("const TROPHIES"), seed.indexOf("export const seed"));
        const names = [...block.matchAll(/^\s*\["([^"]+)"/gm)].map((m) => m[1]);
        expect(names.length).toBeGreaterThan(5);
        expect(names.filter((name) => !isTitleCase(name))).toEqual([]);
    });
});
