// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A module's own words are the module's to ship.
 *
 * `core-names-no-module` reads core's code and its prose, and
 * `every-core-string-is-said-somewhere` proves that every string in
 * `messages-core` is asked for by name. Neither reads the catalogue for who
 * is doing the asking, and between the two of them thirty-five strings sat in
 * core that only a module ever says.
 *
 * They arrived in two ways, and both of them hurt.
 *
 * A module declares `labelKey` on a dashboard widget, an analytics chart or a
 * moderation provider, and the string it names was written into core rather
 * than into the manifest beside the declaration. Measured on 2026-09-19:
 * nineteen keys, belonging to five modules. The screen looks right, because
 * core happens to carry a value for a key core has never heard of - until a
 * sixth module declares one, and then the fallback English label in its
 * manifest is what a Turkish operator reads. Core cannot ship the string for
 * a module that does not exist yet, which is the whole reason a module
 * carries its own catalogue.
 *
 * And a nav entry's label was written in both places at once. Sixteen keys,
 * identical text, so nothing looked wrong: the merge puts a module's row over
 * core's and the module won every time. What the operator sees is the same
 * string listed twice on the translations screen under two different owners,
 * and which copy they edit decides whether their work survives the module
 * being reinstalled. The row filed under Core is the one that does not.
 *
 * So: core ships what core says. A string only a module says belongs to that
 * module, and a string a module already ships is not core's to ship again.
 */

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, keep: (full: string) => boolean, out: string[] = []): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules") continue;
            walk(full, keep, out);
        } else if (/\.(ts|tsx|json)$/.test(entry.name) && keep(full)) {
            out.push(full);
        }
    }
    return out;
}

function read(files: string[]): string {
    return files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

/**
 * Everything core is written in.
 *
 * `src/modules` is a copy of `module-sources` that the dev server runs from,
 * and `src/core/generated` is written out of that copy - it embeds every
 * installed manifest verbatim, so reading it would make core look like it
 * says every word any module has ever said.
 */
const CORE_SOURCE = read(
    walk(path.join(ROOT, "src"), (f) => !f.includes(`${path.sep}modules${path.sep}`) && !f.includes(`${path.sep}generated${path.sep}`)).concat(
        walk(path.join(ROOT, "scripts"), () => true),
    ),
);

const MODULE_SOURCE = read(walk(path.join(ROOT, "module-sources"), () => true));

function flatten(value: unknown, prefix: string, emit: (key: string, value: string) => void): void {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        emit(prefix, String(value ?? ""));
        return;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        flatten(v, prefix ? `${prefix}.${k}` : k, emit);
    }
}

function catalogue(file: string): Map<string, string> {
    const out = new Map<string, string>();
    if (!fs.existsSync(file)) return out;
    flatten(JSON.parse(fs.readFileSync(file, "utf8")), "", (key, value) => out.set(key, value));
    return out;
}

const LOCALES = ["en", "tr"] as const;

const CORE_CATALOGUE = new Map(
    LOCALES.map((locale) => [locale, catalogue(path.join(ROOT, `messages-core/${locale}.json`))] as const),
);

/** Every `namespace.key` a module manifest declares, and who declares it. */
function moduleCatalogue(): Map<string, Map<string, string>> {
    const byLocale = new Map<string, Map<string, string>>(LOCALES.map((l) => [l, new Map()]));
    for (const id of fs.readdirSync(path.join(ROOT, "module-sources"))) {
        const manifest = path.join(ROOT, "module-sources", id, "module.json");
        if (!fs.existsSync(manifest)) continue;
        const translations = JSON.parse(fs.readFileSync(manifest, "utf8")).translations;
        if (!translations || typeof translations !== "object") continue;
        for (const locale of LOCALES) {
            const shipped = (translations as Record<string, unknown>)[locale];
            if (!shipped) continue;
            flatten(shipped, "", (key) => byLocale.get(locale)!.set(key, id));
        }
    }
    return byLocale;
}

const MODULE_CATALOGUE = moduleCatalogue();

/**
 * Namespaces core offers a module on purpose.
 *
 * `common` and the `common_` keys under `admin` are the shared vocabulary - a
 * Save, an Add, an aria-label for a quantity stepper. They are core's words,
 * written once so that nobody writes them again, and a module borrowing one
 * is what they are for. That one of them happens to have a single caller
 * today says nothing about who owns it.
 */
function isSharedVocabulary(name: string): boolean {
    return name.startsWith("common.") || name.startsWith("admin.common_");
}

describe("the core catalogue", () => {
    it("has strings to read, and sources to weigh them against", () => {
        expect(CORE_CATALOGUE.get("en")!.size).toBeGreaterThan(1000);
        expect(MODULE_CATALOGUE.get("en")!.size).toBeGreaterThan(1000);
        expect(CORE_SOURCE.length).toBeGreaterThan(1_000_000);
        expect(MODULE_SOURCE.length).toBeGreaterThan(1_000_000);
    });

    it("ships no string a module already ships", () => {
        const twice: string[] = [];
        for (const locale of LOCALES) {
            const mine = MODULE_CATALOGUE.get(locale)!;
            for (const name of CORE_CATALOGUE.get(locale)!.keys()) {
                const owner = mine.get(name);
                if (owner) twice.push(`${locale} ${name} (also ${owner})`);
            }
        }
        expect(twice, "the module's row wins the merge, so core's copy is a row an operator can edit for nothing").toEqual([]);
    });

    it("ships no string only a module says", () => {
        const theirs: string[] = [];
        for (const [name] of CORE_CATALOGUE.get("en")!) {
            if (isSharedVocabulary(name)) continue;
            // The leaf, which is what a call site writes: `setup.site` is a
            // namespace in its own right, so the key under it is `name` and
            // not `site.name`. A leaf that is an ordinary word passes this
            // rule for free, which is the direction that misses rather than
            // the direction that accuses.
            const key = name.slice(name.lastIndexOf(".") + 1);
            if (CORE_SOURCE.includes(key)) continue;
            if (!MODULE_SOURCE.includes(key)) continue;
            theirs.push(name);
        }
        expect(theirs, "declare it in the manifest beside the labelKey that asks for it").toEqual([]);
    });
});
