/**
 * Build the marketplace ZIPs from module-sources/ and regenerate index.json.
 *
 * Usage: npm run build:marketplace
 *
 * This was a bash script around a Python heredoc, which needed bash and
 * python3 on the PATH: neither is on a Windows one, so a module could not be
 * published from there at all. It is the same pass in the language the rest
 * of the tooling is written in.
 *
 * ZIPs and index.json are both written by the pass below. An archive is a
 * published artifact, so it is written only after the catalog validates, and
 * only when what it holds changed: a rebuild of an unchanged module leaves its
 * archive byte for byte as it was, whichever zlib this machine compresses
 * with. See scripts/lib/deterministic-zip.ts for what a written one holds.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { toolCommand } from "../src/core/lib/tool-command";
import { deterministicZip, type ZipEntry } from "./lib/deterministic-zip";

const SKIP_FILES = new Set([".DS_Store"]);
const SKIP_DIRS = new Set(["__MACOSX", "node_modules"]);

// Category and tags come from each module.json. There is deliberately no
// category table here: a hardcoded module list in build tooling was the last
// place in the repo where adding a module meant editing a shared file.
const FALLBACK_CATEGORY = "content";

// The SDK boundary, scanned as text so a violation can't reach a ZIP. The
// authoritative check with explanations is scripts/validate-module.ts; this is
// the same rule applied to every module at once.
const DEEP_IMPORT = /["']@\/core\/(?:lib|components)\/[^"']*["']/;

// Hook names core itself emits or declares. A module may legitimately listen to
// any of these, so they count as known even though no module declares them.
const CORE_HOOK_SOURCES = ["src/core/lib/hooks.ts", "src/core/types/hook-payloads.d.ts"];
const EMIT_CALL = /\b(?:doAction|doActionAsync|applyFilters|applyFiltersAsync)\(\s*"([^"]+)"/g;

type Json = Record<string, unknown>;

interface HookRef {
    hook: string;
}

interface CatalogEntry {
    id: string;
    zip: string;
    updatedAt: string;
    [key: string]: unknown;
}

/** What Python's `dict.get(key, fallback)` answers: a present key wins, even when it is null. */
function get<T>(object: Json, key: string, fallback: T): T {
    return (key in object ? object[key] : fallback) as T;
}

/** Every packable file under `dir`, named as it sits in the archive, sorted by that name. */
export function moduleFiles(dir: string): ZipEntry[] {
    const out: ZipEntry[] = [];
    const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name)) walk(full);
            } else if (!SKIP_FILES.has(entry.name)) {
                out.push({ name: path.relative(dir, full).split(path.sep).join("/"), data: fs.readFileSync(full) });
            }
        }
    };
    walk(dir);
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Does the archive at `file` already hold exactly these entries, in this order? */
function holds(file: string, entries: ZipEntry[]): boolean {
    if (!fs.existsSync(file)) return false;
    try {
        const packed = new AdmZip(file).getEntries();
        return (
            packed.length === entries.length &&
            packed.every((entry, i) => entry.entryName === entries[i].name && entry.getData().equals(entries[i].data))
        );
    } catch {
        return false;
    }
}

function sourceFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
}

function coreHooks(root: string): Set<string> {
    const hooks = new Set<string>();
    for (const file of sourceFiles(path.join(root, "src"))) {
        for (const match of fs.readFileSync(file, "utf8").matchAll(EMIT_CALL)) hooks.add(match[1]);
    }
    for (const rel of CORE_HOOK_SOURCES) {
        const file = path.join(root, rel);
        if (!fs.existsSync(file)) continue;
        // HookNames constants and the payload-registry keys are both quoted
        // dotted names on their own line; either form declares a core hook.
        for (const match of fs.readFileSync(file, "utf8").matchAll(/"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)"\s*[,:]/g)) {
            hooks.add(match[1]);
        }
    }
    return hooks;
}

/**
 * The locales core ships. A catalog row carries its own translations because
 * the browser reads it before the module is installed - nothing about an
 * uninstalled module is in the Translation table, so an admin browsing the
 * marketplace in Turkish was reading seventy-eight English names.
 */
function catalogI18n(manifest: Json, locales: string[]): Record<string, { name: string; description: string }> {
    const out: Record<string, { name: string; description: string }> = {};
    const translations = (manifest.translations ?? {}) as Record<string, { admin?: Record<string, string> }>;
    for (const locale of locales) {
        if (locale === "en") continue;
        const admin = translations[locale]?.admin ?? {};
        const name = admin[`module_${manifest.id}_name`];
        const description = admin[`module_${manifest.id}_description`];
        if (name || description) {
            out[locale] = {
                name: name || (manifest.name as string),
                description: description || get(manifest, "description", ""),
            };
        }
    }
    return out;
}

export interface BuildResult {
    errors: string[];
    modules: number;
    written: string[];
}

export function buildMarketplace(root: string, now: Date = new Date()): BuildResult {
    const sourcesDir = path.join(root, "module-sources");
    const outputDir = path.join(root, "module-marketplace");
    const buildStamp = now.toISOString().replace(/\.\d{3}Z$/, "Z");

    // Read once. Screenshots are curated content and updatedAt is history: both
    // are carried across rebuilds rather than regenerated.
    let previous = new Map<string, Json>();
    const indexFile = path.join(outputDir, "index.json");
    if (fs.existsSync(indexFile)) {
        try {
            const index = JSON.parse(fs.readFileSync(indexFile, "utf8")) as { modules?: Json[] };
            previous = new Map((index.modules ?? []).map((entry) => [entry.id as string, entry]));
        } catch {
            previous = new Map();
        }
    }

    const locales = fs
        .readdirSync(path.join(root, "messages-core"))
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.slice(0, -".json".length))
        .sort();
    const known = coreHooks(root);

    const modules: CatalogEntry[] = [];
    const violations: string[] = [];
    const emittedBy = new Map<string, string>();
    const listenedBy: [string, string][] = [];

    for (const name of fs.readdirSync(sourcesDir).sort()) {
        const moduleDir = path.join(sourcesDir, name);
        const manifestPath = path.join(moduleDir, "module.json");
        if (!fs.existsSync(manifestPath)) continue;
        const m = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Json;

        for (const file of sourceFiles(moduleDir)) {
            fs.readFileSync(file, "utf8")
                .split("\n")
                .forEach((line, i) => {
                    if (DEEP_IMPORT.test(line)) violations.push(`${path.relative(root, file).split(path.sep).join("/")}:${i + 1}`);
                });
        }

        const emits = (get<HookRef[] | null>(m, "hooksEmitted", []) ?? []).map((h) => h.hook);
        const listens = (get<HookRef[] | null>(m, "hookListeners", []) ?? []).map((h) => h.hook);
        for (const hook of emits) emittedBy.set(hook, m.id as string);
        for (const hook of listens) listenedBy.push([m.id as string, hook]);

        const category = (m.category as string) || FALLBACK_CATEGORY;
        const tags = Array.isArray(m.tags) && m.tags.length > 0 ? m.tags.map(String) : [category];

        const prior = previous.get(m.id as string) ?? {};
        const version = get(m, "version", "1.0.0");
        // updatedAt is shown on the admin modules screen and sorts it. Stamping
        // every module with the build time said all seventy-eight were updated
        // today, every build, and rewrote all seventy-eight lines of index.json
        // whenever any one module changed. A module is updated when its
        // published version changes; otherwise it keeps the date it already had.
        const updatedAt = prior.version === version ? (prior.updatedAt as string | undefined) : undefined;

        modules.push({
            id: m.id as string,
            name: m.name,
            description: get(m, "description", ""),
            i18n: catalogI18n(m, locales),
            version,
            coreVersion: m.coreVersion ?? null,
            author: get(m, "author", "Blysis"),
            icon: get(m, "icon", "Package"),
            category,
            verified: true,
            updatedAt: updatedAt || buildStamp,
            screenshots: (prior.screenshots as unknown[] | undefined) || [],
            tags,
            zip: `${name}.zip`,
            dependencies: get(m, "dependencies", []),
            conflicts: get(m, "conflicts", []),
            hooks: { emits, listens },
            stats: {
                publicRoutes: get<unknown[]>(m, "routes", []).length,
                adminRoutes: get<unknown[]>(m, "adminRoutes", []).length,
                apiRoutes: get<unknown[]>(m, "api", []).length,
                widgets: get<unknown[]>(m, "widgets", []).length,
            },
        });
    }

    // A listener on a hook nothing emits never fires, and nothing reports it -
    // not at build time, not at runtime, not in a log. Checking the whole
    // catalog at once is the only place where both halves of the contract are
    // visible.
    const unknownHooks = listenedBy.filter(([, hook]) => !emittedBy.has(hook) && !known.has(hook));
    if (unknownHooks.length > 0) {
        return {
            modules: modules.length,
            written: [],
            errors: [
                `${unknownHooks.length} hook listener(s) subscribe to a hook nothing emits.`,
                "A listener on an unknown hook silently never runs. Check the spelling, or",
                "declare the hook in the emitting module's hooksEmitted array.",
                ...unknownHooks.map(([id, hook]) => `  ${id}: ${hook}`),
            ],
        };
    }
    if (violations.length > 0) {
        return {
            modules: modules.length,
            written: [],
            errors: [
                `${violations.length} module file(s) reach into core internals (@/core/lib, @/core/components).`,
                "Modules must use the SDK (@/core/sdk*). Run:",
                "  npx tsx scripts/migrate-module-imports.ts module-sources",
                ...violations.slice(0, 10).map((v) => `  ${v}`),
                ...(violations.length > 10 ? [`  ... and ${violations.length - 10} more`] : []),
            ],
        };
    }

    // Only now, with the catalog validated: a module that breaks the SDK
    // boundary or listens to a hook nothing emits gets no published archive.
    const written: string[] = [];
    for (const entry of modules) {
        const files = moduleFiles(path.join(sourcesDir, entry.id));
        const target = path.join(outputDir, entry.zip);
        if (holds(target, files)) continue;
        fs.writeFileSync(target, deterministicZip(files));
        written.push(entry.zip);
    }

    // The catalog was updated when its newest module was, not when the build ran.
    const catalogStamp = modules.map((entry) => entry.updatedAt).sort().at(-1) ?? buildStamp;
    const index = { version: "1.0.0", updated: catalogStamp.slice(0, 10), updatedAt: catalogStamp, modules };
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));

    return { errors: [], modules: modules.length, written };
}

function main(): void {
    const root = process.cwd();
    if (!fs.existsSync(path.join(root, "module-sources"))) {
        console.error("Error: module-sources directory not found");
        process.exit(1);
    }

    const result = buildMarketplace(root);
    if (result.errors.length > 0) {
        console.error(`ERROR: ${result.errors.join("\n")}`);
        process.exit(1);
    }
    console.log(`Index: ${result.modules} modules`);
    console.log(`Built ${result.written.length} of ${result.modules} ZIPs; the rest already held their sources`);

    // The grammar the catalogue's modules were checked against, published
    // beside them. Anything that accepts a module from an author needs it, and
    // without a published copy each of them writes its own guess.
    const schema = spawnSync(...toolCommand(["npx", "tsx", "scripts/emit-manifest-schema.ts"], root), {
        cwd: root,
        stdio: "inherit",
    });
    process.exit(schema.status ?? 1);
}

/** Only when run, never when imported: the tests build a fixture tree with it. */
const invokedDirectly = process.argv[1]?.endsWith("build-marketplace.ts") ?? false;
if (invokedDirectly) main();
