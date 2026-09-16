/**
 * Per-module SQL migration runner.
 *
 * Walks each installed module's migrations/ directory, applies any
 * migration not yet recorded in the ModuleMigration table, and records
 * the checksum + execution time.
 *
 * Usage:
 *   npx tsx scripts/apply-migrations.ts                 # all installed modules
 *   npx tsx scripts/apply-migrations.ts --module=blog   # one module
 *   npx tsx scripts/apply-migrations.ts --dry-run       # preview only
 *   npx tsx scripts/apply-migrations.ts --bootstrap     # mark-as-applied without running
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "../src/core/lib/db";

const ROOT = process.cwd();
const MODULE_SOURCES_DIR = path.join(ROOT, "module-sources");
const INSTALLED_MODULES_DIR = path.join(ROOT, "src/modules");

interface Options {
    moduleFilter: string | null;
    dryRun: boolean;
    bootstrap: boolean;
}

function parseArgs(): Options {
    const args = process.argv.slice(2);
    const moduleArg = args.find((a) => a.startsWith("--module="));
    return {
        moduleFilter: moduleArg ? moduleArg.slice("--module=".length) : null,
        dryRun: args.includes("--dry-run"),
        bootstrap: args.includes("--bootstrap"),
    };
}

function getInstalledModules(): string[] {
    if (!fs.existsSync(INSTALLED_MODULES_DIR)) return [];
    return fs
        .readdirSync(INSTALLED_MODULES_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
}

/**
 * Core's own migrations are recorded under this id, in the same table a
 * module's are. A module can never be called this: `validate-module` requires
 * an id that matches its directory, and `src/modules/core` is not a module.
 */
export const CORE_MIGRATION_OWNER = "core";

/**
 * Everything with migrations to run, core first.
 *
 * A module's migration may reasonably read a core table. A core migration may
 * not read a module's, because the module may not be installed - so the order
 * is not a preference, it is the only one that is always safe.
 */
export function migrationOwners(): string[] {
    return [CORE_MIGRATION_OWNER, ...getInstalledModules()];
}

/** Resolve migrations directory: prefer installed copy, fall back to module-sources. */
export function migrationsDirFor(moduleName: string): string | null {
    if (moduleName === CORE_MIGRATION_OWNER) {
        const core = path.join(ROOT, "prisma/migrations");
        return fs.existsSync(core) ? core : null;
    }
    const installed = path.join(INSTALLED_MODULES_DIR, moduleName, "migrations");
    if (fs.existsSync(installed)) return installed;
    const source = path.join(MODULE_SOURCES_DIR, moduleName, "migrations");
    if (fs.existsSync(source)) return source;
    return null;
}

function listMigrationFiles(dir: string): string[] {
    return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort();
}

/** Resolve a module's own schema file the same way its migrations are resolved. */
function getSchemaPath(moduleName: string): string | null {
    const installed = path.join(INSTALLED_MODULES_DIR, moduleName, "schema.prisma");
    if (fs.existsSync(installed)) return installed;
    const source = path.join(MODULE_SOURCES_DIR, moduleName, "schema.prisma");
    if (fs.existsSync(source)) return source;
    return null;
}

/** The models a module's own schema declares, in the order it declares them. */
export function declaredModels(schema: string): string[] {
    const withoutComments = schema.replace(/^\s*\/\/.*$/gm, "");
    return [...withoutComments.matchAll(/^\s*model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
}

/**
 * Whether the database has caught up with the module's schema.
 *
 * Install merges the schema and reconciles the database on the build that
 * follows, and the migration runner goes before that. A module whose every
 * table is still missing has not been reconciled yet, and a migration that
 * names one of them would fail with 42P01 rather than do nothing.
 *
 * One table present is enough to say yes: a module that gained a model since
 * its last release has some and not others, and its migrations are exactly
 * what brings the rest forward. A module that declares no tables of its own
 * has nothing to wait for and may still migrate a core one.
 */
export function hasBeenReconciled(models: string[], present: Set<string>): boolean {
    if (models.length === 0) return true;
    return models.some((model) => present.has(model));
}

async function tablesPresent(models: string[]): Promise<Set<string>> {
    if (models.length === 0) return new Set();
    const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
        models,
    );
    return new Set(rows.map((r) => r.table_name));
}

function sha256(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
}

/** The part of the client one migration needs, transaction client included. */
export interface MigrationClient {
    $executeRawUnsafe(sql: string): Promise<unknown>;
    moduleMigration: {
        create(args: {
            data: { moduleId: string; migrationName: string; checksum: string; executionMs: number };
        }): Promise<unknown>;
    };
}

interface PendingMigration {
    moduleId: string;
    file: string;
    content: string;
    checksum: string;
}

/**
 * Apply one migration and record that it ran, or do neither.
 *
 * These used to be two writes: the SQL inside a transaction, then the
 * `ModuleMigration` row after it. A process that died in between - a deploy
 * restarting the container, a dropped connection - left the schema changed and
 * nothing saying so, and the next run applied the same file again. An additive
 * migration written with IF NOT EXISTS survives that; an `ADD COLUMN` without
 * it fails and aborts the module, and a data migration applies twice.
 *
 * Postgres runs DDL inside a transaction, so the record belongs in the one
 * that is already open. Exported so a test can watch which client each write
 * goes through: reaching for the module-level client inside the callback runs
 * outside the transaction and looks identical in the source.
 */
export async function applyOneMigration(
    client: { $transaction<T>(run: (tx: MigrationClient) => Promise<T>): Promise<T> },
    migration: PendingMigration,
): Promise<number> {
    const start = Date.now();
    await client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(migration.content);
        await tx.moduleMigration.create({
            data: {
                moduleId: migration.moduleId,
                migrationName: migration.file,
                checksum: migration.checksum,
                executionMs: Date.now() - start,
            },
        });
    });
    return Date.now() - start;
}

interface ApplyResult {
    moduleId: string;
    applied: string[];
    skipped: string[];
    errors: { migration: string; error: string }[];
}

async function applyModuleMigrations(
    moduleId: string,
    options: Options
): Promise<ApplyResult> {
    const result: ApplyResult = { moduleId, applied: [], skipped: [], errors: [] };

    const migrationsDir = migrationsDirFor(moduleId);
    if (!migrationsDir) return result;

    const files = listMigrationFiles(migrationsDir);
    if (files.length === 0) return result;

    // A migration brings an older database forward. On an install into a fresh
    // one there is nothing to bring: the merged schema declares the final shape
    // and the reconcile creates it. Running first means every table the
    // migration names is still missing, which is an error rather than a no-op,
    // and the installer reads that as a failed install.
    const schemaPath = getSchemaPath(moduleId);
    const models = schemaPath ? declaredModels(fs.readFileSync(schemaPath, "utf-8")) : [];
    if (!hasBeenReconciled(models, await tablesPresent(models))) {
        console.log(`  waiting for the schema reconcile, ${files.length} migration(s) deferred`);
        return result;
    }

    const existingRecords = await prisma.moduleMigration.findMany({
        where: { moduleId },
    });
    const appliedMap = new Map<string, string>();
    for (const r of existingRecords) {
        appliedMap.set(r.migrationName, r.checksum);
    }

    for (const file of files) {
        const filePath = path.join(migrationsDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const checksum = sha256(content);

        const existingChecksum = appliedMap.get(file);
        if (existingChecksum !== undefined) {
            if (existingChecksum !== checksum) {
                result.errors.push({
                    migration: file,
                    error: `Checksum mismatch - file was modified after it was applied. Do not edit applied migrations; write a new one instead.`,
                });
                return result; // Abort this module
            }
            result.skipped.push(file);
            continue;
        }

        if (options.dryRun) {
            console.log(`  [dry-run] would apply ${moduleId}/${file}`);
            continue;
        }

        if (options.bootstrap) {
            // Mark as applied without running
            await prisma.moduleMigration.create({
                data: { moduleId, migrationName: file, checksum, executionMs: 0 },
            });
            result.applied.push(file);
            console.log(`  [bootstrap] marked ${moduleId}/${file} as applied (not executed)`);
            continue;
        }

        // The file is handed to Postgres whole: multi-statement files work
        // because the driver sends them as one simple query, and a dollar
        // quoted function body survives for the same reason. A procedure
        // complex enough to need more than that belongs in its own file.
        try {
            const executionMs = await applyOneMigration(prisma, { moduleId, file, content, checksum });
            result.applied.push(file);
            console.log(`  applied ${moduleId}/${file} (${executionMs}ms)`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            result.errors.push({ migration: file, error: message });
            console.error(`  FAILED ${moduleId}/${file}: ${message}`);
            return result; // Abort this module on first failure - do not skip ahead
        }
    }

    return result;
}

/** Main entry. Also exported so the install route can call it directly. */
export async function applyMigrations(options: Options = { moduleFilter: null, dryRun: false, bootstrap: false }): Promise<ApplyResult[]> {
    const modules = options.moduleFilter
        ? [options.moduleFilter]
        : migrationOwners();

    const results: ApplyResult[] = [];
    for (const moduleId of modules) {
        const migrationsDir = migrationsDirFor(moduleId);
        if (!migrationsDir) continue;
        console.log(`\n[${moduleId}]`);
        const result = await applyModuleMigrations(moduleId, options);
        results.push(result);
    }

    return results;
}

// CLI entrypoint
if (require.main === module) {
    (async () => {
        const options = parseArgs();
        console.log("Migration runner starting...");
        if (options.dryRun) console.log("Mode: DRY RUN (no changes will be applied)");
        if (options.bootstrap) console.log("Mode: BOOTSTRAP (mark existing as applied without running)");
        if (options.moduleFilter) console.log(`Filter: ${options.moduleFilter}`);

        const results = await applyMigrations(options);

        const totalApplied = results.reduce((sum, r) => sum + r.applied.length, 0);
        const totalSkipped = results.reduce((sum, r) => sum + r.skipped.length, 0);
        const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

        console.log(`\n── Summary ──`);
        console.log(`Applied: ${totalApplied}`);
        console.log(`Already up-to-date: ${totalSkipped}`);
        console.log(`Errors: ${totalErrors}`);

        if (totalErrors > 0) {
            for (const r of results) {
                for (const e of r.errors) {
                    console.error(`  ${r.moduleId}/${e.migration}: ${e.error}`);
                }
            }
            process.exit(1);
        }

        process.exit(0);
    })();
}
