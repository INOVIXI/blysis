// Docker database bootstrap AND upgrade.
//
// Run by the `migrate` service in docker-compose.yml before the app starts,
// on every `up`. It has two jobs, decided by whether the core `User` table
// already exists:
//
//   FRESH database  - merge schemas, push, and seed the 3 roles + core
//                     permissions + admin user, so `install.sh` yields a
//                     working login out of the box.
//
//   EXISTING database - run the upgrade sequence:
//                     merge-schemas -> apply-schema-additions -> db push ->
//                     apply-migrations. It used to return early here, which
//                     meant pulling a newer image left the database on the old
//                     schema: the install was one command, the upgrade was
//                     silently broken. Seeding is NEVER repeated.
//
// merge-schemas reads src/modules, so the `migrate` service mounts the same
// `modules` volume the app does - otherwise the merged schema would be
// core-only and `db push` would try to drop every table the installed
// modules own.
//
// If any step fails the service exits non-zero and the app never starts
// (`depends_on: service_completed_successfully`). That is deliberate: a
// running app on a mismatched schema is worse than a stopped one.

// Reads DATABASE_URL from .env - this script is run directly via tsx,
// outside Next.js, which is what normally loads the env file.
import "dotenv/config";
import { Pool } from "pg";
import { spawnSync } from "child_process";
import { toolCommand } from "../src/core/lib/tool-command";

async function isInitialized(pool: Pool): Promise<boolean> {
    try {
        const r = await pool.query(`SELECT to_regclass('public."User"') AS t`);
        return r.rows[0]?.t != null;
    } catch {
        // Connection/SQL error → treat as not-initialized; the push below will
        // surface the real error if the DB is genuinely unreachable.
        return false;
    }
}

function run(label: string, argv: string[]): void {
    const result = spawnSync(...toolCommand(argv), { stdio: "inherit" });
    if (result.status !== 0) {
        console.error(`[bootstrap] ${label} failed (exit ${result.status}).`);
        process.exit(result.status ?? 1);
    }
}

/**
 * `prisma db push` on an existing database, tolerating exactly one failure:
 * its refusal to drop something that has rows in it.
 *
 * Uninstalling a module deliberately leaves its tables in place so a
 * reinstall keeps the admin's data. `db push` wants to remove every table the
 * merged schema no longer declares, and when one of them is not empty it
 * stops with "Use the --accept-data-loss flag" and a non-zero exit. Treating
 * that as fatal - which it was - means an operator who ever uninstalled a
 * module with data in it cannot start the app again after an upgrade: the
 * migrate service fails, and `depends_on: service_completed_successfully`
 * keeps the app down with it.
 *
 * The additive half of the same reconciliation has already run by this point,
 * so the schema is current in every direction that matters; what push would
 * still have done is drop things, and declining to drop them is the safe
 * outcome. Every other push failure stays fatal.
 */
function pushTolerantOfRetainedTables(): void {
    const result = spawnSync(...toolCommand(["npx", "prisma", "db", "push"]), {
        encoding: "utf-8",
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    process.stdout.write(output);

    if (result.status === 0) return;

    if (output.includes("--accept-data-loss")) {
        console.warn(
            "[bootstrap] db push declined to drop tables that still hold rows - " +
            "these are almost certainly from a module you uninstalled, and they are kept. " +
            "The schema is otherwise up to date; drop them by hand if you want them gone.",
        );
        return;
    }

    console.error(`[bootstrap] prisma db push failed (exit ${result.status}).`);
    process.exit(result.status ?? 1);
}

async function main(): Promise<void> {
    if (!process.env.DATABASE_URL) {
        console.error("[bootstrap] DATABASE_URL is not set.");
        process.exit(1);
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    let initialized = false;
    try {
        initialized = await isInitialized(pool);
    } finally {
        await pool.end();
    }

    // Rebuild prisma/schema.prisma from the core schema plus whatever modules
    // are installed in the mounted volume right now. On a fresh install that
    // is core-only; on an upgrade it is core + every module the admin added,
    // which is what keeps the reconciliation below from mistaking a live
    // module's tables for leftovers.
    run("merge-schemas", ["npx", "tsx", "scripts/merge-schemas.ts"]);

    if (initialized) {
        console.log("[bootstrap] Existing database - upgrading…");
        // Additive first, and unconditionally: this is the half that cannot
        // fail for a reason the operator should have to think about, and it
        // guarantees every new table and column exists before anything else
        // runs.
        run("apply-schema-additions", ["npx", "tsx", "scripts/apply-schema-additions.ts"]);
        // Then the full reconciliation, for the removals and retypes the
        // additive pass deliberately will not do.
        pushTolerantOfRetainedTables();
        run("apply-migrations", ["npx", "tsx", "scripts/apply-migrations.ts"]);
        // Strings are database rows, so a new release's new keys only exist
        // after this runs. Idempotent, and admin-edited rows are preserved.
        run("seed-translations", ["npx", "tsx", "scripts/seed-translations.ts"]);
        console.log("[bootstrap] Upgrade complete.");
        return;
    }

    // Fresh database: nothing to lose, so push outright.
    //
    // No --skip-generate: Prisma 7 removed the flag (`prisma db push` accepts
    // only --config, --schema, --url, --accept-data-loss and --force-reset),
    // and passing it aborts the push. merge-schemas.ts above already ran
    // `prisma generate`, so there is nothing to skip.
    run("prisma db push", ["npx", "prisma", "db", "push"]);

    console.log("[bootstrap] Fresh database - seeding core data…");
    run("seed", ["npx", "tsx", "prisma/seed.ts"]);
    // Without this every string in the UI renders as its own key.
    run("seed-translations", ["npx", "tsx", "scripts/seed-translations.ts"]);
    console.log("[bootstrap] Done.");
}

main().catch((err) => {
    console.error("[bootstrap] Unexpected error:", err);
    process.exit(1);
});
