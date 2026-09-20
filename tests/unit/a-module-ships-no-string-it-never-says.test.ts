import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A module's catalogue is the strings that module actually says.
 *
 * Three hundred and twenty-three of them said nothing. `servers` shipped
 * eleven strings for an RCON console it does not have; `credits` shipped a
 * transfer form; twenty auth modules shipped `signInWith`, which no sign-in
 * button has ever read. Most of it is scaffolding from whatever the module
 * was generated or copied from, translated into Turkish and carried forward
 * release after release.
 *
 * It costs more here than in core. A module's translations are written into
 * the Translation table when it is installed, so a dead string is rows in
 * somebody's database, and it is the first thing a module author copies when
 * they start the next module.
 *
 * A string counts as said if it appears as a word anywhere in the tree - the
 * module's own code, core, another module - or in any manifest outside the
 * catalogues (a widget's `labelKey`, a settings field's key), or if some
 * template literal in the tree can produce it, or if it is one of the keys
 * core derives from the manifest for the module: its name, its description,
 * and the label of every menu entry and nav group it declares.
 *
 * "As a word" rather than "as a substring", because `adm_addProduct` in the
 * source is not a reader for `addProduct` in the catalogue - which is how
 * sixty of the store's strings survived being renamed out from under them.
 */

const ROOT = path.resolve(__dirname, "../..");

function readTree(base: string): string {
    const parts: string[] = [];
    const walk = (dir: string) => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules") walk(full);
            } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
                parts.push(fs.readFileSync(full, "utf8"));
            }
        }
    };
    walk(base);
    return parts.join("\n");
}

function manifestText(): string {
    const parts: string[] = [];
    for (const id of fs.readdirSync(path.join(ROOT, "module-sources"))) {
        const file = path.join(ROOT, "module-sources", id, "module.json");
        if (!fs.existsSync(file)) continue;
        const { translations: _translations, ...rest } = JSON.parse(fs.readFileSync(file, "utf8"));
        parts.push(JSON.stringify(rest));
    }
    for (const theme of fs.readdirSync(path.join(ROOT, "src/themes"))) {
        const file = path.join(ROOT, "src/themes", theme, "theme.json");
        if (fs.existsSync(file)) parts.push(fs.readFileSync(file, "utf8"));
    }
    return parts.join("\n");
}

const SOURCE = [
    ...["src/core", "src/app", "src/themes", "scripts", "module-sources"].map((d) => readTree(path.join(ROOT, d))),
    manifestText(),
].join("\n");

/** Whole words, so a longer key that merely contains this one is not a reader. */
const WORDS = new Set(SOURCE.match(/[A-Za-z0-9_.-]+/g) ?? []);

/**
 * Every template literal in the tree, as a pattern the key it builds would
 * match: `adm_orderStatus_${status}` becomes /^adm_orderStatus_\w+$/. One
 * that opens with its substitution is skipped - it would match anything. The
 * dot belongs in the alphabet: `err.${code}` is how a module's error codes
 * reach the reader, and leaving it out deleted two of turnstile's.
 */
const CONSTRUCTED: RegExp[] = [...new Set(SOURCE.match(/`[A-Za-z0-9_.-]*\$\{[^`]*\}[A-Za-z0-9_.-]*`/g) ?? [])]
    .map((lit) => lit.slice(1, -1))
    .filter((lit) => /^[A-Za-z0-9_.-]/.test(lit))
    .map((lit) => lit.split(/\$\{[^}]*\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .filter((parts) => parts.length > 1)
    .map((parts) => new RegExp(`^${parts.join("[A-Za-z0-9_]+")}$`));

interface Manifest {
    version: string;
    menu?: { label?: string }[];
    navGroups?: { id?: string }[];
    settingsCards?: unknown[];
    translations?: Record<string, Record<string, Record<string, string>>>;
}

/** Every resource this module records a revision of. */
function revisionResources(id: string): string[] {
    const found = new Set<string>();
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "node_modules") walk(full);
                continue;
            }
            if (!/\.tsx?$/.test(entry.name)) continue;
            for (const hit of fs.readFileSync(full, "utf8").matchAll(/recordRevision\(\s*["']([a-z0-9.-]+)["']/g)) {
                found.add(hit[1]);
            }
        }
    };
    walk(path.join(ROOT, "module-sources", id));
    return [...found];
}

function manifests(): [string, Manifest][] {
    return fs
        .readdirSync(path.join(ROOT, "module-sources"))
        .map((id) => [id, path.join(ROOT, "module-sources", id, "module.json")] as const)
        .filter(([, file]) => fs.existsSync(file))
        .map(([id, file]) => [id, JSON.parse(fs.readFileSync(file, "utf8")) as Manifest]);
}

/** The keys core builds for a module from its manifest, not from its code. */
function derivedKeys(id: string, manifest: Manifest): Set<string> {
    const keys = new Set([`module_${id}_name`, `module_${id}_description`, `menu_${id}`]);
    for (const entry of manifest.menu ?? []) {
        if (entry.label) keys.add(`menu_${id}_${entry.label.replace(/\s+/g, "_").toLowerCase()}`);
    }
    for (const group of manifest.navGroups ?? []) {
        if (group.id) keys.add(`navGroup_${group.id}`);
    }
    // A settings card is named and described by the module that ships it; the
    // sidebar and the palette both look it up under the module's own id.
    if ((manifest.settingsCards ?? []).length > 0) {
        keys.add(`settings_${id}`);
        keys.add(`settings_${id}_description`);
    }
    // A kind of thing the module records a revision of, named for the audit
    // trail. The resource is the module's own word and core derives the key
    // from it, so neither appears written out anywhere.
    for (const resource of revisionResources(id)) {
        keys.add(`revision_${resource.replace(/\./g, "_")}`);
    }
    return keys;
}

describe("a module's translation catalogue", () => {
    const all = manifests();

    it("finds the modules and the sources", () => {
        expect(all.length).toBeGreaterThan(70);
        expect(SOURCE.length).toBeGreaterThan(1_000_000);
        expect(WORDS.size).toBeGreaterThan(10_000);
        expect(CONSTRUCTED.length).toBeGreaterThan(10);
    });

    it("ships no string the site never says", () => {
        const dead: string[] = [];
        for (const [id, manifest] of all) {
            const { translations, ...rest } = manifest;
            const outsideCatalogue = JSON.stringify(rest);
            const derived = derivedKeys(id, manifest);
            // The namespace travels with the key, because a module may offer
            // a string another module renders: a leaderboard board carries
            // `labelKey: "store.leaderboardBuyers"`, and the page that draws
            // the tab resolves it from the root of the catalogue. Without the
            // qualified form those strings read as dead here.
            const keys = new Map<string, string>();
            for (const catalogue of Object.values(translations ?? {})) {
                for (const [namespace, entries] of Object.entries(catalogue)) {
                    if (entries && typeof entries === "object") {
                        for (const key of Object.keys(entries)) keys.set(key, `${namespace}.${key}`);
                    }
                }
            }
            for (const [key, qualified] of keys) {
                if (WORDS.has(key)) continue;
                if (WORDS.has(qualified)) continue;
                if (outsideCatalogue.includes(key)) continue;
                if (derived.has(key)) continue;
                if (CONSTRUCTED.some((pattern) => pattern.test(key))) continue;
                dead.push(`${id}: ${key}`);
            }
        }
        expect(dead).toEqual([]);
    });

    it("carries the same keys in every locale it ships", () => {
        const uneven: string[] = [];
        for (const [id, manifest] of all) {
            const locales = Object.entries(manifest.translations ?? {});
            if (locales.length < 2) continue;
            const flatten = (catalogue: Record<string, Record<string, string>>) =>
                new Set(
                    Object.entries(catalogue).flatMap(([ns, entries]) =>
                        entries && typeof entries === "object" ? Object.keys(entries).map((k) => `${ns}.${k}`) : [],
                    ),
                );
            const [[firstLocale, first], ...others] = locales;
            const reference = flatten(first);
            for (const [locale, catalogue] of others) {
                const here = flatten(catalogue);
                for (const key of reference) if (!here.has(key)) uneven.push(`${id}: ${locale} is missing ${key}`);
                for (const key of here) if (!reference.has(key)) uneven.push(`${id}: ${firstLocale} is missing ${key}`);
            }
        }
        expect(uneven).toEqual([]);
    });
});
