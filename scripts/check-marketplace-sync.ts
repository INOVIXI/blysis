/**
 * Verify that the committed marketplace artifacts match their sources.
 *
 * `module-marketplace/` holds ZIPs and an index.json built from
 * `module-sources/` by scripts/build-marketplace.ts. Both are committed, and
 * until this check existed nothing compared one against the other - so a
 * module edited without a rebuild kept shipping its old code to every user
 * who installed it from the in-app marketplace.
 *
 * That is not hypothetical: blog, forum, help-center and store were published
 * for the whole 0.2.0 cycle without the `searchProviders[].indexes` block
 * their sources had gained, which is exactly the capability CORE_API_VERSION
 * 1.1.0 was cut for. Search still returned the right rows, but the four
 * largest content tables never got their GIN indexes, so every query fell
 * back to a sequential scan recomputing a tsvector per row.
 *
 * The comparison is content-based, not byte-based: rebuilding a ZIP rewrites
 * its embedded timestamps even when nothing inside changed, so comparing the
 * files themselves would fail on every run.
 *
 * Usage: npx tsx scripts/check-marketplace-sync.ts
 */

import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

const ROOT = process.cwd();
const SOURCES_DIR = path.join(ROOT, "module-sources");
const OUTPUT_DIR = path.join(ROOT, "module-marketplace");
const INDEX_FILE = path.join(OUTPUT_DIR, "index.json");

/** Files build-marketplace.ts deliberately keeps out of the ZIPs. */
const EXCLUDED = new Set([".DS_Store"]);

const problems: string[] = [];

function fail(message: string): void {
    problems.push(message);
}

/**
 * Read a JSON file, reporting a parse failure as a problem rather than a
 * stack trace - a malformed manifest is exactly the kind of thing this
 * check exists to name.
 */
function readJson<T>(file: string, label: string): T | null {
    try {
        return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
    } catch (err) {
        fail(`${label}: ${file.replace(ROOT + path.sep, "")} is not valid JSON - ${(err as Error).message}`);
        return null;
    }
}

/** Every file under `dir`, as paths relative to it, sorted. */
function listFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (EXCLUDED.has(entry.name) || entry.name === "__MACOSX") continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else out.push(path.relative(dir, full).split(path.sep).join("/"));
        }
    };
    walk(dir);
    return out.sort();
}

/** The ZIP's file entries, keyed by the same relative path shape. */
function readZip(zipPath: string): Map<string, Buffer> {
    const files = new Map<string, Buffer>();
    for (const entry of new AdmZip(zipPath).getEntries()) {
        if (entry.isDirectory) continue;
        const name = entry.entryName.replace(/^\.\//, "");
        const base = name.split("/").pop() ?? name;
        if (EXCLUDED.has(base) || name.startsWith("__MACOSX/")) continue;
        files.set(name, entry.getData());
    }
    return files;
}

function compareModule(id: string): void {
    const sourceDir = path.join(SOURCES_DIR, id);
    const zipPath = path.join(OUTPUT_DIR, `${id}.zip`);

    const sourceFiles = listFiles(sourceDir);
    const zipFiles = readZip(zipPath);

    for (const rel of sourceFiles) {
        const packed = zipFiles.get(rel);
        if (!packed) {
            fail(`${id}: ${rel} exists in module-sources but not in the published ZIP`);
            continue;
        }
        const onDisk = fs.readFileSync(path.join(sourceDir, rel));
        if (!packed.equals(onDisk)) {
            fail(`${id}: ${rel} differs between module-sources and the published ZIP`);
        }
    }

    const sourceSet = new Set(sourceFiles);
    for (const rel of zipFiles.keys()) {
        if (!sourceSet.has(rel)) {
            fail(`${id}: ${rel} is in the published ZIP but no longer in module-sources`);
        }
    }
}

function main(): void {
    if (!fs.existsSync(SOURCES_DIR)) {
        console.error("module-sources/ not found - run from the repository root.");
        process.exit(1);
    }

    const sourceIds = fs
        .readdirSync(SOURCES_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(SOURCES_DIR, e.name, "module.json")))
        .map((e) => e.name)
        .sort();

    const zipIds = fs
        .readdirSync(OUTPUT_DIR)
        .filter((f) => f.endsWith(".zip"))
        .map((f) => f.slice(0, -4))
        .sort();

    for (const id of sourceIds) {
        if (!zipIds.includes(id)) fail(`${id}: has a source but no published ZIP`);
    }
    for (const id of zipIds) {
        if (!sourceIds.includes(id)) fail(`${id}: has a published ZIP but no source`);
    }

    for (const id of sourceIds) {
        if (zipIds.includes(id)) compareModule(id);
    }

    // The catalogue the admin UI reads has to agree with what is on disk, and
    // its version/coreVersion columns are what the compatibility gate checks
    // before it ever downloads a ZIP.
    const index = readJson<{
        modules: Array<{ id: string; version?: string; coreVersion?: string }>;
    }>(INDEX_FILE, "index.json");
    if (!index) {
        report();
        return;
    }
    const indexed = new Map(index.modules.map((m) => [m.id, m]));

    for (const id of zipIds) {
        if (!indexed.has(id)) fail(`${id}: has a published ZIP but no index.json entry`);
    }
    for (const id of indexed.keys()) {
        if (!zipIds.includes(id)) fail(`${id}: is listed in index.json but has no ZIP`);
    }

    for (const id of sourceIds) {
        const entry = indexed.get(id);
        if (!entry) continue;
        const manifest = readJson<{ version?: string; coreVersion?: string }>(
            path.join(SOURCES_DIR, id, "module.json"), id,
        );
        if (!manifest) continue;
        if (entry.version !== manifest.version) {
            fail(`${id}: index.json says version ${entry.version}, manifest says ${manifest.version}`);
        }
        if (entry.coreVersion !== manifest.coreVersion) {
            fail(`${id}: index.json says coreVersion ${entry.coreVersion}, manifest says ${manifest.coreVersion}`);
        }
    }

    report(zipIds.length);
}

function report(zipCount?: number): void {
    if (problems.length > 0) {
        console.error(`Marketplace artifacts are out of sync (${problems.length} problem(s)):\n`);
        for (const p of problems) console.error(`  ${p}`);
        console.error("\nRebuild them with:  npm run build:marketplace");
        process.exit(1);
    }

    console.log(`Marketplace is in sync: ${zipCount} ZIPs match module-sources/ and index.json.`);
}

main();
