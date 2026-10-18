import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * `t.has(key) ? t(key) : "English"` earns its place exactly once: when the key
 * is not known until runtime. A module contributes a sidebar label, a status
 * map names a key built from a database column, a notification channel is
 * whatever the install enabled - in each of those the guard asks a question
 * whose answer genuinely varies, and the literal on the right is the last
 * resort for a key nobody can look up ahead of time.
 *
 * Written against a key spelled out in the source, it asks a question whose
 * answer is already decided. Either the catalogue has the key, in which case
 * the branch never runs and the English text is dead, or it does not, in which
 * case every locale silently gets English and nothing ever reports it. Both
 * outcomes are worse than the unguarded call: next-intl renders the key path
 * for a genuinely missing message, which is ugly and therefore gets fixed,
 * and `module-translation-keys` already fails a module that renders a key it
 * never declared. The guard is what turned that failure into a whisper.
 *
 * 246 of these had accumulated - 88 written inline and 158 behind a
 * `fallback(key, en)` helper - and every single guarded key was present in
 * both locales. This test keeps them from coming back, and covers core's own
 * keys the way `module-translation-keys` covers a module's.
 */

const root = path.resolve(import.meta.dirname, "../..");
const coreMessagesDir = path.join(root, "messages-core");
const coreDirs = [path.join(root, "src", "app"), path.join(root, "src", "core")];
const sourcesDir = path.join(root, "module-sources");

/**
 * A key that is only known at runtime. The guard is the supported way to
 * render one, so the ban below is on literal keys only.
 */
const LITERAL_KEY = /^[\w.]+$/;

/**
 * The one file where a literal-key guard is the right call, with the reason
 * it is the exception rather than the rule.
 */
const GUARD_STAYS: Record<string, string> = {
    "src/app/[locale]/error.tsx":
        "the error boundary renders when something upstream has already failed, " +
        "which includes the request that loads the message catalogue - a guard " +
        "here is the difference between a readable error page and no page at all",
};

type Messages = Record<string, unknown>;

const locales = fs
    .readdirSync(coreMessagesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.basename(f, ".json"));

/**
 * Flattens a catalogue into `namespace -> key -> string`, where a nested group
 * becomes its own dotted namespace. That is how a component names it:
 * `useTranslations("setup.welcome")`, never `useTranslations("setup")` with a
 * dotted key.
 */
function namespaces(messages: Messages, prefix = ""): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    const keys = new Set<string>();
    for (const [name, value] of Object.entries(messages)) {
        if (value !== null && typeof value === "object") {
            for (const [ns, group] of namespaces(value as Messages, prefix ? `${prefix}.${name}` : name)) {
                out.set(ns, group);
            }
        } else {
            keys.add(name);
        }
    }
    if (prefix) out.set(prefix, keys);
    return out;
}

const coreCatalogue = new Map<string, Map<string, Set<string>>>(
    locales.map((locale) => [
        locale,
        namespaces(JSON.parse(fs.readFileSync(path.join(coreMessagesDir, `${locale}.json`), "utf8"))),
    ]),
);

function sourceFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
}

/** `binding -> namespace` for every `useTranslations`/`getTranslations` in a file. */
function bindings(content: string): Map<string, string> {
    const found = new Map<string, string>();
    const pattern =
        /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(\s*["'`]([^"'`]+)["'`]/g;
    for (const match of content.matchAll(pattern)) found.set(match[1], match[2]);
    return found;
}

const coreFiles = coreDirs.flatMap(sourceFiles);
const moduleFiles = sourceFiles(sourcesDir);

/** Every `t.has("literal")` in the tree, with the file that writes it. */
function literalGuards(files: string[]): { file: string; key: string }[] {
    const found: { file: string; key: string }[] = [];
    for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        if (!content.includes(".has")) continue;
        const rel = path.relative(root, file);
        for (const binding of bindings(content).keys()) {
            const pattern = new RegExp(`\\b${binding}\\.has\\s*\\(\\s*["'\`]([^"'\`$]+)["'\`]\\s*\\)`, "g");
            for (const match of content.matchAll(pattern)) {
                if (!LITERAL_KEY.test(match[1])) continue;
                found.push({ file: rel, key: match[1] });
            }
        }
    }
    return found;
}

describe("a guard is not a translation", () => {
    it("reads every locale of the core catalogue", () => {
        expect([...locales].sort()).toEqual(["az", "de", "en", "es", "et", "fr", "it", "pl", "pt", "ru", "tr", "zh"]);
        for (const locale of locales) {
            expect(coreCatalogue.get(locale)!.size).toBeGreaterThan(10);
        }
    });

    it("finds the core screens to check", () => {
        expect(coreFiles.length).toBeGreaterThan(200);
        expect(moduleFiles.length).toBeGreaterThan(400);
    });

    it("renders no core key the core catalogue is missing", () => {
        const missing: string[] = [];
        for (const file of coreFiles) {
            const content = fs.readFileSync(file, "utf8");
            if (!content.includes("Translations(")) continue;
            const rel = path.relative(root, file);
            for (const [binding, namespace] of bindings(content)) {
                const pattern = new RegExp(`\\b${binding}(?:\\.rich|\\.markup)?\\s*\\(\\s*["'\`]([^"'\`$]+)["'\`]`, "g");
                for (const match of content.matchAll(pattern)) {
                    const key = match[1];
                    if (!LITERAL_KEY.test(key)) continue;
                    for (const locale of locales) {
                        const bucket = coreCatalogue.get(locale)!.get(namespace);
                        // A namespace core does not own belongs to a module,
                        // which `module-translation-keys` checks instead.
                        if (!bucket) continue;
                        if (!bucket.has(key)) missing.push(`${rel}: ${namespace}.${key} (${locale})`);
                    }
                }
            }
        }
        expect(missing, "a core screen renders a key no locale carries").toEqual([]);
    });

    it("carries the same core keys in every locale", () => {
        const [first, ...rest] = locales;
        const reference = coreCatalogue.get(first)!;
        const gaps: string[] = [];
        for (const locale of rest) {
            const other = coreCatalogue.get(locale)!;
            for (const [namespace, keys] of reference) {
                for (const key of keys) {
                    if (!other.get(namespace)?.has(key)) gaps.push(`${namespace}.${key} missing from ${locale}`);
                }
            }
            for (const [namespace, keys] of other) {
                for (const key of keys) {
                    if (!reference.get(namespace)?.has(key)) gaps.push(`${namespace}.${key} missing from ${first}`);
                }
            }
        }
        expect(gaps, "the locales have drifted apart").toEqual([]);
    });

    it("guards no key that is spelled out in the source", () => {
        const guarded = literalGuards([...coreFiles, ...moduleFiles])
            .filter((g) => GUARD_STAYS[g.file] === undefined)
            .map((g) => `${g.file}: t.has("${g.key}")`);
        expect(
            guarded,
            "a literal key is either in the catalogue, making the guard dead, " +
                "or missing from it, making English the answer for every locale",
        ).toEqual([]);
    });

    it("keeps the guard where the catalogue may not have loaded at all", () => {
        for (const [file, reason] of Object.entries(GUARD_STAYS)) {
            expect(fs.existsSync(path.join(root, file)), `${file} is allowlisted but gone`).toBe(true);
            expect(reason.length, `${file} needs a reason`).toBeGreaterThan(40);
        }
        const content = fs.readFileSync(path.join(root, "src/app/[locale]/error.tsx"), "utf8");
        expect(content).toContain("t.has(");
    });

    it("has no helper that hides a literal-key guard behind a call", () => {
        const offenders: string[] = [];
        for (const file of [...coreFiles, ...moduleFiles]) {
            const content = fs.readFileSync(file, "utf8");
            if (path.relative(root, file) in GUARD_STAYS) continue;
            // `(key, en) => t.has(key) ? t(key) : en` and any spelling of it.
            if (/\(\s*\w+\s*:\s*string\s*,\s*\w+\s*:\s*string\s*\)\s*=>\s*\(?\s*\w+\.has\(/.test(content)) {
                offenders.push(path.relative(root, file));
            }
        }
        expect(
            offenders,
            "a two-string helper turns every call site into a literal-key guard the scan above cannot see",
        ).toEqual([]);
    });
});
