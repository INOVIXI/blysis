/**
 * Module install lock + build queue.
 * Prevents concurrent installs from racing and ensures build runs only once
 * after all pending installs complete.
 *
 * Scenarios handled:
 * 1. Bulk install (37 modules) - build runs ONCE at the end, not 37 times
 * 2. Concurrent install requests - queued, not rejected
 * 3. Build already running - waits for completion
 * 4. Restart debounce - a single process replacement after the build
 * 5. Partial install failure - does not block other installs
 *
 * The lock itself is a Postgres advisory lock, so a second process - a
 * lingering old container during a deploy, or an operator running a script
 * against the same database - cannot start an install while one is underway.
 * The in-process flag is kept as a fast path so concurrent requests to this
 * process can early-reject without a round trip.
 *
 * Note that running two app processes permanently is not a supported
 * topology: they would compile into the same .next. The lock narrows the window, it does not make that safe.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { errorText, log } from "./logger";
import { writeSchemaState } from "./build-state";
import { discardStagedBuild, markStagedBuildReady, prepareStagedBuild } from "./staged-build";

const execFileAsync = promisify(execFile);

/**
 * Ask the supervisor to replace this process, after letting in-flight work
 * finish. SIGTERM (not `process.exit`) so the shutdown registry installed by
 * src/instrumentation.ts runs: Prisma drains, the scheduler interval clears,
 * and open responses are allowed to complete inside the grace window.
 *
 * The short delay lets the HTTP response that triggered the install reach the
 * admin's browser first - without it the request that installed a module dies
 * with the process and the UI reports a failure for a build that succeeded.
 */
function requestRestart(): void {
    log.info("install-lock: build complete, restarting to serve it", {
        step: "restart",
        pid: process.pid,
    });
    setTimeout(() => {
        process.kill(process.pid, "SIGTERM");
    }, RESTART_GRACE_MS).unref();
}

// Advisory lock key - arbitrary constant. Postgres session-level advisory
// locks are identified by a bigint; any app-wide constant works as long as
// nothing else in the schema reuses the same value. Use a BigInt literal:
// the hex value exceeds Number.MAX_SAFE_INTEGER, so a plain `number` would
// round, and two PM2 workers could compute different float approximations
// and acquire technically different locks (mutual exclusion would silently
// break).
const INSTALL_ADVISORY_LOCK_KEY = BigInt("0x626c794d6f64496e"); // "blyModIn"

let installing = false;
let buildScheduled = false;
let buildRunning = false;
let buildTimer: ReturnType<typeof setTimeout> | null = null;
const BUILD_DEBOUNCE_MS = 3000; // Wait 3s after last install before building
/** A build that has not finished in this long is taken to be hung. */
const BUILD_TIMEOUT_MS = 45 * 60 * 1000;
/** `next build` is chatty; execFile kills the child when its output passes this. */
const BUILD_OUTPUT_BUFFER = 64 * 1024 * 1024;
const RESTART_GRACE_MS = 2000;  // Let the triggering HTTP response flush first

// Dedicated pg pool with a single connection so the advisory lock acquire
// and release are guaranteed to execute on the same Postgres session.
// Prisma's own connection pool can recycle connections between calls, which
// makes pg_advisory_unlock a no-op when the release lands on a different
// connection - the lock then leaks until the original session is closed.
// Lazily required via eval("require") to keep Turbopack from bundling pg.
type LockClient = {
    query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
    release(): void;
};
type LockPool = { connect(): Promise<LockClient>; end(): Promise<void> };
let lockPool: LockPool | null = null;
function getLockPool(): LockPool {
    if (!lockPool) {
        const _require = typeof __webpack_require__ === "function"
            ? __non_webpack_require__
            : eval("require");
        const { Pool } = _require("pg");
        lockPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 }) as LockPool;
    }
    return lockPool;
}

/** Check if an install is currently running (this worker only) */
export function isInstalling(): boolean {
    return installing;
}

/**
 * Acquire install lock - returns release function or null if another
 * install is already running (either in this worker or another one).
 *
 * Holds a dedicated pg client checked out from a single-purpose pool so
 * pg_try_advisory_lock and pg_advisory_unlock run on the same Postgres
 * session. Without this, Prisma's pool may release the unlock on a
 * different physical connection - making it a silent no-op while the
 * lock continues to be held by the original session.
 */
export async function acquireInstallLock(): Promise<(() => void) | null> {
    // Fast path: another request in this worker already holds the lock.
    if (installing) return null;

    let client: LockClient | null = null;
    try {
        client = await getLockPool().connect();
        const result = await client.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock($1::bigint) AS locked",
            [INSTALL_ADVISORY_LOCK_KEY.toString()],
        );
        const gotLock = result.rows?.[0]?.locked === true;
        if (!gotLock) {
            client.release();
            return null;
        }

        installing = true;
        const heldClient = client;
        return () => {
            installing = false;
            heldClient
                .query("SELECT pg_advisory_unlock($1::bigint)", [INSTALL_ADVISORY_LOCK_KEY.toString()])
                .catch(() => { /* already released or connection gone */ })
                .finally(() => { try { heldClient.release(); } catch { /* noop */ } });
        };
    } catch (err) {
        if (client) { try { client.release(); } catch { /* noop */ } }
        // DB unreachable - fall back to in-process lock so single-worker
        // setups (no Postgres yet, e.g. during initial setup wizard)
        // still get some mutual exclusion.
        log.error("[install-lock] advisory lock failed, falling back to in-process", { error: errorText(err) });
        installing = true;
        return () => { installing = false; };
    }
}

declare const __webpack_require__: unknown;
declare const __non_webpack_require__: NodeRequire;

/**
 * Schedule a deferred build + restart.
 * If called multiple times within DEBOUNCE window, only runs once.
 * Used by bulk install to avoid 37 sequential builds.
 */
export function scheduleBuild(): void {
    // Dev mode: Turbopack handles recompile, skip the production build
    // pipeline. `NEXT_DEV` was a typo - Next.js sets NODE_ENV=development
    // during `next dev`, not a custom NEXT_DEV flag, so the old check
    // was a no-op and full builds ran even while the dev server was up.
    if (process.env.NODE_ENV !== "production") return;

    buildScheduled = true;

    // Clear previous timer
    if (buildTimer) clearTimeout(buildTimer);

    // Debounce: wait for more installs to finish
    buildTimer = setTimeout(async () => {
        if (buildRunning) return; // Another build is already running
        buildRunning = true;
        buildScheduled = false;

        try {
            // 1. Rebuild prisma/schema.prisma from the core schema plus every
            //    module currently in src/modules. This is what makes the push
            //    below safe: the merged schema describes the modules that are
            //    actually installed, so the diff adds their tables rather than
            //    dropping tables it does not know about.
            let schemaMerged = true;
            try {
                await execFileAsync("npx", ["tsx", "scripts/merge-schemas.ts"], {
                    cwd: process.cwd(), timeout: 60000,
                });
            } catch (err) {
                schemaMerged = false;
                // Non-fatal: Prisma Client types may be stale until next merge.
                log.error("install-lock: schema merge failed", {
                    step: "merge-schemas",
                    error: errorText(err),
                });
            }

            // 2. Create the tables the merged schema declares.
            //
            //    Twenty-five of the twenty-six modules that ship a
            //    schema.prisma ship no migrations/ directory, because
            //    migrations are for altering a module's schema *after* it
            //    is deployed, and the schema
            //    itself is what creates the tables on first install. This
            //    step used to be absent - the comment on step 3 read
            //    "replaces db push" - so installing any of those modules one
            //    at a time left it enabled with none of its tables: every one
            //    of its API routes answered 500 with Prisma P2021 and its
            //    cron job logged the same error once a minute, forever. Bulk
            //    install pushed and worked, which is how the gap stayed
            //    invisible.
            //
            //    `prisma db push` is not what runs here, though it is the
            //    obvious choice and was the first thing tried. It reconciles
            //    the *whole* database to the merged schema, and uninstall
            //    deliberately leaves a module's tables behind so a reinstall
            //    keeps the admin's data - so after any uninstall the database
            //    legitimately holds tables the schema no longer mentions, and
            //    push either drops them silently or refuses to run at all.
            //    scripts/apply-schema-additions.ts asks Prisma for the same
            //    diff and runs only the statements that add.
            //
            //    Skipped when the merge failed: a stale or core-only merged
            //    schema describes a database this instance does not have.
            if (schemaMerged) {
                try {
                    await execFileAsync("npx", ["tsx", "scripts/apply-schema-additions.ts"], {
                        cwd: process.cwd(), timeout: 120000,
                    });
                } catch (err) {
                    log.error("install-lock: schema additions failed", {
                        step: "schema-additions",
                        error: errorText(err),
                    });
                }
            } else {
                log.error("install-lock: skipping schema additions after a failed merge", {
                    step: "schema-additions",
                });
            }

            // 3. Apply per-module SQL migrations - schema changes a module
            //    shipped after its initial release.
            try {
                await execFileAsync("npx", ["tsx", "scripts/apply-migrations.ts"], {
                    cwd: process.cwd(), timeout: 120000,
                });
            } catch (err) {
                // Non-fatal: module tables may be missing until migrations re-run.
                log.error("install-lock: migrations failed", {
                    step: "apply-migrations",
                    error: errorText(err),
                });
            }

            // 4. Generate registry
            try {
                await execFileAsync("npx", ["tsx", "scripts/generate-registry.ts"], {
                    cwd: process.cwd(), timeout: 30000,
                });
            } catch (err) {
                // Non-fatal: registry may not reflect newly installed modules.
                log.error("install-lock: registry generation failed", {
                    step: "generate-registry",
                    error: errorText(err),
                });
            }

            // 5. Build, staged (staged-build.ts): beside the live build, which
            //    this process is serving from and goes on serving until the
            //    restart below. Building into `.next` itself emptied it under
            //    the running server, so every visitor during a build got
            //    pages whose chunks were gone, and a failed build left none.
            //
            //    The timeout only bounds a build that hangs. It used to be
            //    five minutes, which a full module set outgrows on a small
            //    machine, and a killed build was a lost build; now it costs
            //    nothing but the wait.
            await execFileAsync("npm", ["run", "build"], {
                cwd: process.cwd(),
                env: prepareStagedBuild(),
                timeout: BUILD_TIMEOUT_MS,
                maxBuffer: BUILD_OUTPUT_BUFFER,
            });

            // 6. Record what the build and the regenerated Prisma client were
            //    made from. The build's record goes into the staged build, so
            //    it arrives with it, and marks it ready to promote.
            markStagedBuildReady();
            writeSchemaState();

            // 7. Replace the process so the new build is actually served.
            //
            //    The staged build is promoted by the reconciler on the way
            //    back up, before `next start`, while nothing is reading
            //    `.next` - never under a running server, which holds the old
            //    build's manifests and would name chunks that had just gone.
            //
            //    `next start` reads the route + build manifests once, at boot,
            //    so an install is not live until the process is replaced. This
            //    used to call `npx pm2 restart blysis` inside a try/catch -
            //    and pm2 is in neither the image nor package.json, so the call
            //    always threw and was always swallowed. Every module install
            //    rebuilt and then served the old build.
            //
            //    Raising SIGTERM on ourselves is the portable replacement: it
            //    runs the shutdown registry (draining Prisma, clearing the
            //    scheduler interval) and exits, and every supervisor this
            //    project supports treats that as "start me again" -
            //    docker-compose `restart: unless-stopped`, systemd
            //    `Restart=always`, Kubernetes, and pm2 if an operator uses it.
            requestRestart();
        } catch (err) {
            // The live build was never touched and goes on being served; the
            // half-made one is thrown away. The modules installed since the
            // live build stay unusable until a build succeeds.
            discardStagedBuild();
            log.error("install-lock: build failed, the previous build stays live", {
                step: "build",
                error: errorText(err),
            });
        } finally {
            buildRunning = false;

            // If more installs happened during build, schedule another
            if (buildScheduled) {
                scheduleBuild();
            }
        }
    }, BUILD_DEBOUNCE_MS);
}

/** Check if a build is currently running or scheduled */
export function isBuildPending(): boolean {
    return buildRunning || buildScheduled;
}
