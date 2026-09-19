/*
 * module-dev.ts
 * ---------------------------------------------------------------
 * Developer CLI for scaffolding new module-contributable extensions
 * into existing Blysis modules.
 *
 * USAGE
 *   npx tsx scripts/module-dev.ts <subcommand> [args...]
 *
 * SUBCOMMANDS
 *
 *   add-hook     <module> <hookName>
 *     Example: add-hook discord-integration user.registered
 *     Creates module-sources/<module>/listeners/<hookName>.ts (mirrored
 *     in src/modules) from a listener template and appends an entry to
 *     the manifest's `hookListeners` array. Re-runs registry generator.
 *
 *   add-slot     <module> <slotName> <ComponentName>
 *     Creates module-sources/<module>/slots/<ComponentName>.tsx (mirrored)
 *     and adds it to the manifest's `slotContents` array.
 *
 *   add-cron     <module> <jobId> <schedule>
 *     schedule must be one of:
 *       every-minute | every-5-minutes | every-15-minutes |
 *       every-hour | every-day | every-week | every-month
 *     Creates module-sources/<module>/cron/<jobId>.ts (mirrored) and
 *     adds it to the manifest's `cronJobs` array.
 *
 *   add-search   <module> <providerId>
 *     Creates module-sources/<module>/search/<providerId>.ts (mirrored)
 *     and adds it to the manifest's `searchProviders` array.
 *
 *   list-modules
 *     Prints every installed module with version and contribution counts.
 *
 * NOTES
 *   - All "add-*" commands edit BOTH module-sources/<module>/ and
 *     src/modules/<module>/ so the scaffold is immediately available at
 *     runtime without a separate copy step.
 *   - Manifest updates preserve 2-space JSON indentation.
 *   - After any add-* command, scripts/generate-registry.ts is re-run so
 *     the generated registry files reflect the new contribution.
 *   - Prints a summary of every file/manifest change at the end.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();
const SOURCES_DIR = path.join(ROOT, "module-sources");
const MODULES_DIR = path.join(ROOT, "src/modules");

const VALID_SCHEDULES = [
    "every-minute",
    "every-5-minutes",
    "every-15-minutes",
    "every-hour",
    "every-day",
    "every-week",
    "every-month",
];

// ───────────────────────────────── Types ─────────────────────────────────

interface ManifestHookListener { hook: string; type: "action" | "filter"; handler: string; priority?: number }
interface ManifestSlotContent { id: string; slot: string; component: string; order?: number }
interface ManifestCronJob { id: string; schedule: string; handler: string }
interface ManifestSearchProvider { id: string; label: string; handler: string }

interface Manifest {
    id?: string;
    name?: string;
    version?: string;
    hookListeners?: ManifestHookListener[];
    slotContents?: ManifestSlotContent[];
    cronJobs?: ManifestCronJob[];
    searchProviders?: ManifestSearchProvider[];
    [key: string]: unknown;
}

// ───────────────────────────────── Helpers ─────────────────────────────────

function fail(message: string): never {
    console.error(`Error: ${message}`);
    process.exit(1);
}

function moduleDirs(moduleName: string): { sources: string; modules: string } {
    return {
        sources: path.join(SOURCES_DIR, moduleName),
        modules: path.join(MODULES_DIR, moduleName),
    };
}

function assertModuleExists(moduleName: string): void {
    const dirs = moduleDirs(moduleName);
    const manifest = path.join(dirs.sources, "module.json");
    if (!fs.existsSync(dirs.sources) || !fs.existsSync(manifest)) {
        fail(`Module "${moduleName}" not found at ${dirs.sources} (missing module.json).`);
    }
}

function readManifest(manifestPath: string): Manifest {
    const raw = fs.readFileSync(manifestPath, "utf8");
    try {
        return JSON.parse(raw) as Manifest;
    } catch (err) {
        fail(`Invalid JSON in ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
}

function writeManifest(manifestPath: string, manifest: Manifest): void {
    // Preserve 2-space indent + trailing newline (matches existing manifests).
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

function writeFileBoth(relPath: string, content: string, moduleName: string, changes: string[]): void {
    const dirs = moduleDirs(moduleName);
    for (const base of [dirs.sources, dirs.modules]) {
        if (!fs.existsSync(base)) continue;
        const full = path.join(base, relPath);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        // "wx" fails if the file is already there, so the check and the write
        // are one operation rather than two with a gap between them.
        try {
            fs.writeFileSync(full, content, { flag: "wx" });
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "EEXIST") {
                fail(`File already exists: ${path.relative(ROOT, full)}`);
            }
            throw err;
        }
        changes.push(`created ${path.relative(ROOT, full)}`);
    }
}

function updateManifestBoth(
    moduleName: string,
    updater: (manifest: Manifest) => void,
    changes: string[],
): void {
    const dirs = moduleDirs(moduleName);
    for (const base of [dirs.sources, dirs.modules]) {
        const manifestPath = path.join(base, "module.json");
        if (!fs.existsSync(manifestPath)) continue;
        const manifest = readManifest(manifestPath);
        updater(manifest);
        writeManifest(manifestPath, manifest);
        changes.push(`updated ${path.relative(ROOT, manifestPath)}`);
    }
}

function runRegistryGenerator(changes: string[]): void {
    try {
        execSync("npx tsx scripts/generate-registry.ts", { cwd: ROOT, stdio: "inherit" });
        changes.push("regenerated src/core/generated/module-registry.tsx");
    } catch {
        console.error("Warning: generate-registry.ts failed. Inspect the output above.");
    }
}

function printChanges(title: string, changes: string[]): void {
    console.log(`\n${title}`);
    console.log("─".repeat(60));
    for (const c of changes) {
        console.log(`  - ${c}`);
    }
    console.log("");
}

function isValidIdentifier(name: string, pattern: RegExp, label: string): void {
    if (!pattern.test(name)) {
        fail(`Invalid ${label} "${name}".`);
    }
}

// ───────────────────────────────── Templates ─────────────────────────────────

function hookListenerTemplate(hookName: string): string {
    return `/**
 * Hook listener: fires on \`${hookName}\`.
 * Replace the body with whatever side effect this module wants to run.
 *
 * Action listeners return void; filter listeners return the (possibly
 * modified) payload.
 */
export default async function on${toPascalCase(hookName)}(payload: unknown): Promise<void> {
    // TODO: implement listener logic for ${hookName}
    void payload;
}
`;
}

function slotTemplate(slotName: string, componentName: string): string {
    return `"use client";

import React from "react";

/**
 * Slot content: injected into \`${slotName}\`.
 * Rendered automatically when the host template mounts the named slot.
 */
export default function ${componentName}(): React.ReactElement {
    return (
        <div className="py-2 text-sm text-muted-foreground">
            ${componentName} slot content
        </div>
    );
}
`;
}

function cronTemplate(jobId: string, schedule: string): string {
    return `/**
 * Cron job: ${jobId}
 * Schedule: ${schedule}
 *
 * Runs on the core scheduler. Exported as an async default fn.
 */
export default async function ${toCamelCase(jobId)}(): Promise<void> {
    // TODO: implement cron job "${jobId}" (${schedule})
}
`;
}

function searchProviderTemplate(providerId: string): string {
    return `/**
 * Public search provider: ${providerId}
 * Invoked by /api/v1/search when a user searches the site.
 *
 * Return an array of SearchResult-compatible objects. Shape is kept
 * permissive here so modules can add extra fields without fighting the
 * core type.
 */
export interface SearchResult {
    id: string;
    title: string;
    url: string;
    snippet?: string;
}

export default async function search(query: string): Promise<SearchResult[]> {
    void query;
    // TODO: implement search for ${providerId}
    return [];
}
`;
}

// ───────────────────────────────── Case helpers ─────────────────────────────────

function toPascalCase(input: string): string {
    return input
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
}

function toCamelCase(input: string): string {
    const pascal = toPascalCase(input);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

// ───────────────────────────────── Subcommands ─────────────────────────────────

function cmdAddHook(args: string[]): void {
    const [moduleName, hookName] = args;
    if (!moduleName || !hookName) {
        fail("Usage: module-dev add-hook <module> <hookName>");
    }
    assertModuleExists(moduleName);
    isValidIdentifier(hookName, /^[a-zA-Z][a-zA-Z0-9._-]*$/, "hook name");

    const safeFileName = hookName.replace(/[^a-zA-Z0-9-]+/g, "-");
    const relFile = path.join("listeners", `${safeFileName}.ts`);
    const changes: string[] = [];

    writeFileBoth(relFile, hookListenerTemplate(hookName), moduleName, changes);

    updateManifestBoth(moduleName, (manifest) => {
        const list = (manifest.hookListeners ?? []) as ManifestHookListener[];
        if (list.some((h) => h.hook === hookName && h.handler === relFile)) {
            fail(`hookListeners already contains ${hookName} -> ${relFile} in ${moduleName}.`);
        }
        list.push({ hook: hookName, type: "action", handler: relFile });
        manifest.hookListeners = list;
    }, changes);

    runRegistryGenerator(changes);
    printChanges(`add-hook ${moduleName} ${hookName}`, changes);
}

function cmdAddSlot(args: string[]): void {
    const [moduleName, slotName, componentName] = args;
    if (!moduleName || !slotName || !componentName) {
        fail("Usage: module-dev add-slot <module> <slotName> <ComponentName>");
    }
    assertModuleExists(moduleName);
    isValidIdentifier(componentName, /^[A-Z][A-Za-z0-9]*$/, "component name (PascalCase)");
    isValidIdentifier(slotName, /^[a-zA-Z][a-zA-Z0-9._-]*$/, "slot name");

    const relFile = path.join("slots", `${componentName}.tsx`);
    const changes: string[] = [];

    writeFileBoth(relFile, slotTemplate(slotName, componentName), moduleName, changes);

    updateManifestBoth(moduleName, (manifest) => {
        const list = (manifest.slotContents ?? []) as ManifestSlotContent[];
        if (list.some((s) => s.id === componentName)) {
            fail(`slotContents already contains id "${componentName}" in ${moduleName}.`);
        }
        list.push({ id: componentName, slot: slotName, component: relFile });
        manifest.slotContents = list;
    }, changes);

    runRegistryGenerator(changes);
    printChanges(`add-slot ${moduleName} ${slotName} ${componentName}`, changes);
}

function cmdAddCron(args: string[]): void {
    const [moduleName, jobId, schedule] = args;
    if (!moduleName || !jobId || !schedule) {
        fail("Usage: module-dev add-cron <module> <jobId> <schedule>");
    }
    assertModuleExists(moduleName);
    isValidIdentifier(jobId, /^[a-z][a-zA-Z0-9-_]*$/, "jobId (start with lowercase letter)");
    if (!VALID_SCHEDULES.includes(schedule)) {
        fail(`Invalid schedule "${schedule}". Must be one of: ${VALID_SCHEDULES.join(", ")}`);
    }

    const relFile = path.join("cron", `${jobId}.ts`);
    const changes: string[] = [];

    writeFileBoth(relFile, cronTemplate(jobId, schedule), moduleName, changes);

    updateManifestBoth(moduleName, (manifest) => {
        const list = (manifest.cronJobs ?? []) as ManifestCronJob[];
        if (list.some((c) => c.id === jobId)) {
            fail(`cronJobs already contains id "${jobId}" in ${moduleName}.`);
        }
        list.push({ id: jobId, schedule, handler: relFile });
        manifest.cronJobs = list;
    }, changes);

    runRegistryGenerator(changes);
    printChanges(`add-cron ${moduleName} ${jobId} ${schedule}`, changes);
}

function cmdAddSearch(args: string[]): void {
    const [moduleName, providerId] = args;
    if (!moduleName || !providerId) {
        fail("Usage: module-dev add-search <module> <providerId>");
    }
    assertModuleExists(moduleName);
    isValidIdentifier(providerId, /^[a-z][a-zA-Z0-9-_]*$/, "providerId (start with lowercase letter)");

    const relFile = path.join("search", `${providerId}.ts`);
    const changes: string[] = [];

    writeFileBoth(relFile, searchProviderTemplate(providerId), moduleName, changes);

    updateManifestBoth(moduleName, (manifest) => {
        const list = (manifest.searchProviders ?? []) as ManifestSearchProvider[];
        if (list.some((p) => p.id === providerId)) {
            fail(`searchProviders already contains id "${providerId}" in ${moduleName}.`);
        }
        list.push({ id: providerId, label: providerId, handler: relFile });
        manifest.searchProviders = list;
    }, changes);

    runRegistryGenerator(changes);
    printChanges(`add-search ${moduleName} ${providerId}`, changes);
}

function cmdListModules(): void {
    if (!fs.existsSync(MODULES_DIR)) {
        console.log("No installed modules directory at src/modules.");
        return;
    }

    const names = fs.readdirSync(MODULES_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();

    if (names.length === 0) {
        console.log("No modules installed.");
        return;
    }

    const rows: Array<{ id: string; version: string; counts: string }> = [];
    for (const name of names) {
        const manifestPath = path.join(MODULES_DIR, name, "module.json");
        if (!fs.existsSync(manifestPath)) continue;
        try {
            const manifest = readManifest(manifestPath);
            const counts: string[] = [];
            const push = (key: keyof Manifest, label: string): void => {
                const arr = manifest[key] as unknown[] | undefined;
                if (Array.isArray(arr) && arr.length > 0) counts.push(`${label}=${arr.length}`);
            };
            push("api", "api");
            push("routes", "routes");
            push("adminRoutes", "admin");
            push("hookListeners", "hooks");
            push("slotContents", "slots");
            push("cronJobs", "crons");
            push("searchProviders", "search");
            push("widgets", "widgets");
            push("navLinks", "navLinks");

            rows.push({
                id: name,
                version: manifest.version || "-",
                counts: counts.length > 0 ? counts.join(" ") : "(none)",
            });
        } catch (err) {
            rows.push({
                id: name,
                version: "INVALID",
                counts: err instanceof Error ? err.message : String(err),
            });
        }
    }

    const idWidth = Math.max(...rows.map((r) => r.id.length), 8);
    const versionWidth = Math.max(...rows.map((r) => r.version.length), 7);

    console.log(`\nInstalled modules: ${rows.length}`);
    console.log("─".repeat(80));
    console.log(`${"MODULE".padEnd(idWidth)}  ${"VERSION".padEnd(versionWidth)}  COUNTS`);
    console.log("─".repeat(80));
    for (const r of rows) {
        console.log(`${r.id.padEnd(idWidth)}  ${r.version.padEnd(versionWidth)}  ${r.counts}`);
    }
    console.log("");
}

// ───────────────────────────────── Dispatcher ─────────────────────────────────

function usage(): never {
    console.error("Usage: npx tsx scripts/module-dev.ts <subcommand> [args...]");
    console.error("");
    console.error("Subcommands:");
    console.error("  add-hook      <module> <hookName>");
    console.error("  add-slot      <module> <slotName> <ComponentName>");
    console.error("  add-cron      <module> <jobId> <schedule>");
    console.error("  add-search    <module> <providerId>");
    console.error("  list-modules");
    console.error("");
    console.error("Schedules: " + VALID_SCHEDULES.join(" | "));
    process.exit(1);
}

function main(): void {
    const [subcommand, ...rest] = process.argv.slice(2);
    if (!subcommand) usage();

    switch (subcommand) {
        case "add-hook":     return cmdAddHook(rest);
        case "add-slot":     return cmdAddSlot(rest);
        case "add-cron":     return cmdAddCron(rest);
        case "add-search":   return cmdAddSearch(rest);
        case "list-modules": return cmdListModules();
        default:
            console.error(`Unknown subcommand: ${subcommand}`);
            usage();
    }
}

main();
