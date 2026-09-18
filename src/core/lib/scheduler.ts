import { prisma } from "@/core/lib/db";
import { onShutdown, installShutdownHandlers, isShuttingDown } from "@/core/lib/shutdown";
import { SCHEDULE_MS } from "./cron-schedules";
import { errorText, log } from "./logger";

/**
 * Lightweight cron-style scheduler.
 *
 * Runs in-process via setInterval, ticks every minute. On each tick:
 *   1. Reads CronRun rows for all known job keys
 *   2. Determines which jobs are due based on their schedule
 *   3. Executes each due job inside a try/catch
 *   4. Updates CronRun with the result
 *
 * Schedule keywords:
 *   every-minute      → 1 min
 *   every-5-minutes   → 5 min
 *   every-15-minutes  → 15 min
 *   every-hour        → 60 min
 *   every-day         → 24 h
 *   every-week        → 7 d
 *   every-month       → 30 d
 *
 * Jobs are registered by:
 *   - Core (built-in: revision pruning, etc.) - registered in this file
 *   - Modules - picked up from manifest.cronJobs at server bootstrap
 *
 * Multi-process safety: each tick first tries to atomically claim the job
 * slot via an INSERT ... ON CONFLICT DO UPDATE WHERE "lastRunAt" is stale.
 * Postgres guarantees exactly one worker wins that row write, so a PM2
 * cluster (or a rolling deployment with overlap) can never execute the
 * same job handler twice inside one interval.
 */

export type CronHandler = () => Promise<void>;

interface CronJob {
    key: string;          // "<moduleId>:<jobId>" or "core:<jobId>"
    schedule: string;
    handler: CronHandler;
}


const registeredJobs = new Map<string, CronJob>();
let tickerStarted = false;
let tickIntervalHandle: ReturnType<typeof setInterval> | null = null;
let tickTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

export function registerCronJob(job: CronJob): void {
    if (!SCHEDULE_MS[job.schedule]) {
        log.warn(`[scheduler] Unknown schedule "${job.schedule}" for ${job.key}`);
        return;
    }
    registeredJobs.set(job.key, job);
}

/**
 * Try to claim a job slot atomically. Returns true when this worker just
 * reserved the interval, false when another worker got there first or the
 * job isn't yet due.
 *
 * The INSERT ... ON CONFLICT DO UPDATE ... WHERE pattern is the whole
 * cluster-safety story: Postgres serializes the write, and our WHERE only
 * permits the update if the row is stale (or missing). Two workers that
 * both find the job "due" via a stale read will race here, and exactly
 * one of them sees affected-row-count = 1.
 */
async function claimJob(key: string, schedule: string): Promise<boolean> {
    const intervalMs = SCHEDULE_MS[schedule];
    if (!intervalMs) return false;
    try {
        const affected = await prisma.$executeRaw`
            INSERT INTO "CronRun" ("jobKey", "lastRunAt", "lastStatus")
            VALUES (${key}, NOW(), 'running')
            ON CONFLICT ("jobKey") DO UPDATE
                SET "lastRunAt" = NOW(), "lastStatus" = 'running'
                WHERE "CronRun"."lastRunAt" < NOW() - make_interval(secs => ${intervalMs / 1000})
        `;
        return affected === 1;
    } catch (err) {
        log.error(`[scheduler] claim failed for ${key}`, { error: errorText(err) });
        return false;
    }
}

async function runJob(job: CronJob): Promise<void> {
    const start = Date.now();
    let status: "ok" | "error" = "ok";
    let error: string | null = null;
    try {
        await job.handler();
    } catch (err) {
        status = "error";
        error = errorText(err);
        log.error(`[scheduler] Job ${job.key} failed`, { error: errorText(err) });
    }
    const lastRunMs = Date.now() - start;
    const lastRunAt = new Date();
    const intervalMs = SCHEDULE_MS[job.schedule];
    const nextRunAt = intervalMs ? new Date(lastRunAt.getTime() + intervalMs) : null;

    try {
        await prisma.cronRun.update({
            where: { jobKey: job.key },
            data: { lastRunAt, lastStatus: status, lastError: error, lastRunMs, nextRunAt },
        });
    } catch (err) {
        log.error(`[scheduler] Failed to record run for ${job.key}`, { error: errorText(err) });
    }
}

/**
 * Whether a job belongs to a module the admin has switched off.
 *
 * Registration happens once, at bootstrap, and there is no reset path: a
 * module disabled while the server is running stays registered until the
 * process restarts. Every other subsystem honours the flag immediately -
 * the proxy refuses the module's routes, `bootstrapHooks` skips its
 * listeners and `resetHooks()` re-runs on the toggle, search drops its
 * provider - and the scheduler was the one that did not. So a disabled blog
 * went on publishing scheduled articles, a disabled currency module went on
 * calling an exchange rate API, and the admin had no way to tell.
 *
 * Checked per tick rather than at registration, because that is what makes
 * the toggle take effect now instead of at the next restart.
 */
function isDisabled(key: string, states: Record<string, boolean>): boolean {
    if (key.startsWith("core:")) return false;
    const moduleId = key.slice(0, key.indexOf(":"));
    // An id with no row is enabled, the same convention getModuleStates
    // documents: an empty map during a DB blip must not silence every job.
    return states[moduleId] === false;
}

async function tick(): Promise<string[]> {
    const ran: string[] = [];
    if (isShuttingDown()) return ran;

    /*
     * A job is a module graph like a request is, and this one was never
     * filled. `instrumentation.ts` bootstraps the hook bus once per process
     * but in its own graph, so a job calling `applyFiltersAsync` found no
     * listeners and got its own input back - no error, no log line, and a run
     * that reports success in three milliseconds having written nothing.
     * Every other path that is about to ask a module a question calls this
     * first; see `ensureHooks`. After the first call in a graph it is a
     * boolean comparison, so it costs nothing on a per-tick path.
     *
     * A registry that will not load is a module's problem and must not stop
     * core's own pruning from running, so it is reported rather than thrown.
     */
    try {
        const { ensureHooks } = await import("./hooks-bootstrap");
        await ensureHooks();
    } catch (err) {
        log.error("[scheduler] Could not register module hook listeners", { error: errorText(err) });
    }

    let states: Record<string, boolean> = {};
    try {
        const { getModuleStates } = await import("./module-cache");
        states = await getModuleStates();
    } catch (err) {
        // Fail soft, as getModuleStates itself does: an unreadable config
        // means no explicit state is known, and every job stays eligible.
        log.error("[scheduler] Could not read module states", { error: errorText(err) });
    }

    for (const job of registeredJobs.values()) {
        if (isShuttingDown()) return ran;
        if (isDisabled(job.key, states)) continue;
        try {
            if (await claimJob(job.key, job.schedule)) {
                await runJob(job);
                ran.push(job.key);
            }
        } catch (err) {
            log.error(`[scheduler] Tick error for ${job.key}`, { error: errorText(err) });
        }
    }
    return ran;
}

/**
 * One tick, driven from outside the process.
 *
 * `POST /api/v1/admin/cron` is the trigger the deployment guide tells an
 * operator to wire an external cron to, for a host where the in-process
 * ticker cannot be relied on. It used to call a parallel task list that
 * knew about exactly one core cleanup and nothing about the registered
 * jobs at all, so an operator following those instructions ran none of
 * core's jobs and none of the modules' while the documentation said it ran
 * both.
 *
 * Claiming is what makes two triggers safe: the in-process ticker and an
 * external one race on the same `CronRun` row, and exactly one wins the
 * interval, so nothing runs twice.
 */
export async function runDueJobs(): Promise<string[]> {
    await bootstrapScheduler();
    return tick();
}

/**
 * Bootstrap: registers core jobs, loads module jobs, starts the ticker.
 * Idempotent.
 */
export async function bootstrapScheduler(): Promise<void> {
    if (tickerStarted) return;
    tickerStarted = true;

    // ─── Core built-in jobs ───
    registerCronJob({
        key: "core:prune-revisions",
        schedule: "every-day",
        handler: async () => {
            const { pruneOldRevisions } = await import("./revisions");
            const count = await pruneOldRevisions(90);
            log.info("cron: prune-revisions complete", { job: "prune-revisions", removed: count });
        },
    });

    registerCronJob({
        key: "core:expire-warnings",
        schedule: "every-hour",
        handler: async () => {
            const result = await prisma.userWarning.updateMany({
                where: { isActive: true, expiresAt: { lt: new Date() } },
                data: { isActive: false },
            });
            if (result.count > 0) log.info("cron: expire-warnings complete", { job: "expire-warnings", expired: result.count });
        },
    });

    registerCronJob({
        key: "core:sweep-timed-roles",
        schedule: "every-15-minutes",
        handler: async () => {
            const { sweepLapsedRoles } = await import("./timed-roles");
            const reverted = await sweepLapsedRoles();
            if (reverted > 0) {
                log.info("cron: timed roles taken back", { job: "sweep-timed-roles", reverted });
            }
        },
    });

    registerCronJob({
        key: "core:process-broadcasts",
        schedule: "every-minute",
        handler: async () => {
            const { processQueuedBroadcasts } = await import("./broadcasts");
            await processQueuedBroadcasts();
        },
    });

    registerCronJob({
        key: "core:process-email-queue",
        schedule: "every-5-minutes",
        handler: async () => {
            const { processEmailQueue } = await import("./email");
            const result = await processEmailQueue();
            if (result.sent > 0 || result.failed > 0) {
                log.info("cron: email-queue drained", { job: "email-queue", sent: result.sent, failed: result.failed });
            }
        },
    });

    registerCronJob({
        key: "core:retention-prune",
        schedule: "every-day",
        handler: async () => {
            const { pruneOldRecords } = await import("./retention");
            const r = await pruneOldRecords();
            // Read off the result rather than listed by hand. The list was
            // one name short of the result for as long as there were five
            // counts, so the table added last was swept in silence.
            const total = Object.values(r).reduce((sum, n) => sum + n, 0);
            if (total > 0) {
                log.info("cron: retention sweep complete", { job: "retention", ...r });
            }
        },
    });

    registerCronJob({
        key: "core:health-alerting",
        schedule: "every-5-minutes",
        handler: async () => {
            const { checkAndAlert } = await import("./health-alerting");
            const result = await checkAndAlert();
            if (result.notified) {
                log.info("cron: health alert sent", { job: "health-alerting", status: result.status });
            }
        },
    });

    registerCronJob({
        key: "core:prune-ip-blocks",
        schedule: "every-hour",
        handler: async () => {
            const { invalidateIpBlockCache } = await import("./ip-blocks");
            // Hard-delete blocks that expired > 7 days ago so the
            // table doesn't accumulate stale rows forever. Expired
            // blocks are already filtered at query time, but pruning
            // keeps the list tidy.
            const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const result = await prisma.ipBlock.deleteMany({
                where: { expiresAt: { lt: cutoff, not: null } },
            });
            invalidateIpBlockCache();
            if (result.count > 0) {
                log.info("cron: prune-ip-blocks complete", { job: "prune-ip-blocks", removed: result.count });
            }
        },
    });

    registerCronJob({
        key: "core:automated-backup",
        schedule: "every-day",
        // Nothing is caught here. `runJob` writes the failure into this job's
        // CronRun row, which is what the observability screen reads; catching
        // it made a backup that never ran report `ok`. It never ran: pg_dump
        // is on neither the runtime image nor a plain Node dev box, and
        // `backups/` was empty while the dashboard was green.
        //
        // Whether it runs at all is the operator's answer, not this file's:
        // an install that backs up from outside can switch it off instead of
        // collecting one error a night.
        handler: async () => {
            const { runScheduledBackup } = await import("./backup-schedule");
            await runScheduledBackup();
        },
    });

    // ─── Module-contributed jobs ───
    try {
        const { ModuleCronJobs } = await import("@/core/generated/module-crons");
        for (const entry of ModuleCronJobs) {
            try {
                const mod = await entry.loader();
                const handler = mod.default;
                if (typeof handler !== "function") {
                    log.warn(`[scheduler] ${entry.module}/${entry.id}: no default async function exported`);
                    continue;
                }
                registerCronJob({
                    key: `${entry.module}:${entry.id}`,
                    schedule: entry.schedule,
                    handler: handler as CronHandler,
                });
            } catch (err) {
                log.error(`[scheduler] Failed to load ${entry.module}/${entry.id}`, { error: errorText(err) });
            }
        }
    } catch {
        // module-crons.ts may not exist on first build - silently continue
    }

    log.info("scheduler started", { jobs: registeredJobs.size, tickIntervalMs: 60_000 });

    // First tick after a short delay so the server settles
    tickTimeoutHandle = setTimeout(() => { void tick(); }, 5_000);
    // Recurring tick
    tickIntervalHandle = setInterval(() => { void tick(); }, 60_000);

    // Cooperative shutdown: stop emitting ticks so the event loop can drain.
    // A long-running cron handler already in flight finishes; new ones are
    // skipped via isShuttingDown() inside tick().
    installShutdownHandlers();
    onShutdown("scheduler", () => {
        if (tickTimeoutHandle) {
            clearTimeout(tickTimeoutHandle);
            tickTimeoutHandle = null;
        }
        if (tickIntervalHandle) {
            clearInterval(tickIntervalHandle);
            tickIntervalHandle = null;
        }
    });
}

export function listScheduledJobs(): { key: string; schedule: string }[] {
    return Array.from(registeredJobs.values()).map((j) => ({ key: j.key, schedule: j.schedule }));
}

/**
 * List all currently registered jobs (key + schedule). Used by the admin
 * cron page to show every job, even ones that have never executed yet.
 */
export function listRegisteredJobs(): { key: string; schedule: string }[] {
    return Array.from(registeredJobs.values()).map((j) => ({ key: j.key, schedule: j.schedule }));
}

/**
 * Manually invoke a registered job by key. Updates CronRun like a normal
 * scheduled execution. Throws if no job is registered with that key.
 */
export async function runJobNow(key: string): Promise<void> {
    const job = registeredJobs.get(key);
    if (!job) {
        throw new Error(`No registered cron job with key "${key}"`);
    }
    // The admin cron page lists every registered job, including those of a
    // module switched off since boot. Running one by hand would do the work
    // the toggle was meant to stop, so say what happened instead.
    const { getModuleStates } = await import("./module-cache");
    if (isDisabled(key, await getModuleStates())) {
        throw new Error(`Module "${key.slice(0, key.indexOf(":"))}" is disabled`);
    }
    await runJob(job);
}
