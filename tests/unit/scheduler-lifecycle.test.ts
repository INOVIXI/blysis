import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The scheduler moved onto the boot path in 0.2.0: it used to be started
 * from a render of the root layout (per-request, per-locale, and never at
 * all for an instance serving only API routes) and is now started once from
 * `src/instrumentation.ts`. That makes its failure modes real for the first
 * time - a ticker that never starts means backups, the email queue, warning
 * expiry and health alerting all silently stop, and nothing surfaces it.
 *
 * The other half is cluster safety. `claimJob` is the only thing keeping two
 * processes from running the same handler in the same interval, and its
 * whole contract is the affected-row count of one `INSERT ... ON CONFLICT`.
 *
 * `tests/unit/scheduler.test.ts` covers registration; this file covers the
 * claim, the run bookkeeping, the tick loop and shutdown.
 */

interface RawCall { sql: string; values: unknown[] }

let rawCalls: RawCall[];
let claimAffected: number | Error;
let updateCalls: { where: unknown; data: Record<string, unknown> }[];
let updateThrows: unknown;
let shuttingDown: boolean;
let shutdownHandlers: Map<string, () => void>;

vi.mock("@/core/lib/db", () => ({
    prisma: {
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
            rawCalls.push({ sql: strings.join("?"), values });
            if (claimAffected instanceof Error) throw claimAffected;
            return claimAffected;
        },
        cronRun: {
            update: async (args: { where: unknown; data: Record<string, unknown> }) => {
                if (updateThrows) throw updateThrows;
                updateCalls.push(args);
                return {};
            },
        },
        userWarning: { updateMany: async () => ({ count: 0 }) },
        ipBlock: { deleteMany: async () => ({ count: 0 }) },
    },
}));

vi.mock("@/core/lib/shutdown", () => ({
    isShuttingDown: () => shuttingDown,
    installShutdownHandlers: vi.fn(),
    onShutdown: (name: string, fn: () => void) => { shutdownHandlers.set(name, fn); },
}));

vi.mock("@/core/lib/logger", () => ({
    
    errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The eight core jobs are registered by bootstrapScheduler and therefore run
// on every tick. Stub what their handlers reach for so a tick stays a unit
// test of the loop rather than of everything the loop can call.
/**
 * A tick fills the hook bus before it runs anything, because a job is a module
 * graph like a request is. Registering the real listeners means lazy-importing
 * every installed module's handler, which is the whole system again and not
 * what this file measures - and the drain below counts microtasks, which a
 * chain of dynamic imports does not resolve in.
 * `a-scheduled-job-can-ask-a-module-a-question.test.ts` is where that call is
 * held to its contract.
 */
vi.mock("@/core/lib/hooks-bootstrap", () => ({
    ensureHooks: async () => {},
    bootstrapHooks: async () => {},
}));
vi.mock("@/core/lib/revisions", () => ({ pruneOldRevisions: async () => 0 }));
vi.mock("@/core/lib/timed-roles", () => ({ sweepLapsedRoles: async () => 0 }));
vi.mock("@/core/lib/broadcasts", () => ({ processQueuedBroadcasts: async () => undefined }));
vi.mock("@/core/lib/email", () => ({ processEmailQueue: async () => ({ sent: 0, failed: 0 }) }));
/**
 * The shape here is the shape `pruneOldRecords` really returns. It used to
 * name `webhookLog` and `cronRun`, which that function stopped touching two
 * changes ago, so this stub described a contract nothing had.
 */
let pruned = {
    activityLog: 0, activityFeed: 0, revision: 0, userSession: 0, verificationToken: 0,
};
vi.mock("@/core/lib/retention", () => ({ pruneOldRecords: async () => pruned }));
vi.mock("@/core/lib/health-alerting", () => ({ checkAndAlert: async () => ({ notified: false }) }));
vi.mock("@/core/lib/ip-blocks", () => ({ invalidateIpBlockCache: () => { } }));
vi.mock("@/core/lib/backup", () => ({ createBackup: async () => ({ filename: "f", sizeBytes: 1 }) }));
// The backup job asks whether it is switched on before it dumps anything, and
// that read is a database call this file's prisma stub does not answer. Same
// reason as the stubs above: a tick is a test of the loop.
vi.mock("@/core/lib/backup-schedule", () => ({ runScheduledBackup: async () => undefined }));

let moduleCrons: { module: string; id: string; schedule: string; loader: () => Promise<unknown> }[];
let cronsImportThrows: boolean;

vi.mock("@/core/generated/module-crons", () => {
    if (cronsImportThrows) throw new Error("module-crons.ts does not exist yet");
    return { get ModuleCronJobs() { return moduleCrons; } };
});

type Scheduler = typeof import("@/core/lib/scheduler");

async function load(): Promise<Scheduler> {
    vi.resetModules();
    return import("@/core/lib/scheduler");
}

beforeEach(() => {
    rawCalls = [];
    claimAffected = 1;
    updateCalls = [];
    updateThrows = null;
    shuttingDown = false;
    shutdownHandlers = new Map();
    moduleCrons = [];
    cronsImportThrows = false;
    vi.spyOn(console, "error").mockImplementation(() => { });
    vi.spyOn(console, "warn").mockImplementation(() => { });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("registerCronJob", () => {
    it.each([
        "every-minute", "every-5-minutes", "every-15-minutes",
        "every-hour", "every-day", "every-week", "every-month",
    ])("accepts the %o keyword", async (schedule) => {
        const { registerCronJob, listRegisteredJobs } = await load();
        registerCronJob({ key: "t:job", schedule, handler: async () => { } });

        expect(listRegisteredJobs()).toContainEqual({ key: "t:job", schedule });
    });

    it("replaces a job re-registered under the same key", async () => {
        const { registerCronJob, listRegisteredJobs } = await load();
        registerCronJob({ key: "t:job", schedule: "every-hour", handler: async () => { } });
        registerCronJob({ key: "t:job", schedule: "every-day", handler: async () => { } });

        // A module reinstall must not leave two copies ticking.
        expect(listRegisteredJobs().filter((j) => j.key === "t:job")).toEqual([
            { key: "t:job", schedule: "every-day" },
        ]);
    });
});

describe("runJobNow", () => {
    it("throws for a key nobody registered", async () => {
        const { runJobNow } = await load();
        await expect(runJobNow("nope:missing")).rejects.toThrow(/No registered cron job/);
    });

    it("records a successful run with its duration and next due time", async () => {
        const { registerCronJob, runJobNow } = await load();
        registerCronJob({ key: "t:job", schedule: "every-hour", handler: async () => { } });

        await runJobNow("t:job");

        expect(updateCalls[0].where).toEqual({ jobKey: "t:job" });
        expect(updateCalls[0].data).toMatchObject({ lastStatus: "ok", lastError: null });
        const { lastRunAt, nextRunAt } = updateCalls[0].data as { lastRunAt: Date; nextRunAt: Date };
        // The admin cron page reads nextRunAt; an hour job must not claim to
        // be due again immediately.
        expect(nextRunAt.getTime() - lastRunAt.getTime()).toBe(60 * 60_000);
    });

    it("records a failed run instead of propagating the error", async () => {
        const { registerCronJob, runJobNow } = await load();
        registerCronJob({
            key: "t:bad", schedule: "every-hour",
            handler: async () => { throw new Error("upstream timed out"); },
        });

        // One broken handler must not take down the tick that runs the rest.
        await expect(runJobNow("t:bad")).resolves.toBeUndefined();
        expect(updateCalls[0].data).toMatchObject({
            lastStatus: "error", lastError: "upstream timed out",
        });
    });

    it("records a thrown non-Error", async () => {
        const { registerCronJob, runJobNow } = await load();
        registerCronJob({
            key: "t:bad", schedule: "every-hour",
            handler: async () => { throw "just a string"; },
        });

        await runJobNow("t:bad");
        expect(updateCalls[0].data).toMatchObject({ lastError: "just a string" });
    });

    it("survives a bookkeeping write that fails", async () => {
        updateThrows = new Error("CronRun table missing");
        const { registerCronJob, runJobNow } = await load();
        const handler = vi.fn(async () => { });
        registerCronJob({ key: "t:job", schedule: "every-hour", handler });

        // The work was done; failing to write the receipt must not make it
        // look like the job never ran, nor throw into the caller.
        await expect(runJobNow("t:job")).resolves.toBeUndefined();
        expect(handler).toHaveBeenCalledOnce();
    });
});

describe("bootstrapScheduler", () => {
    it("registers every core job exactly once and starts the ticker", async () => {
        vi.useFakeTimers();
        const { bootstrapScheduler, listRegisteredJobs } = await load();

        await bootstrapScheduler();

        const keys = listRegisteredJobs().map((j) => j.key);
        // Losing any of these is silent: nobody notices a backup that was
        // never taken until they need it.
        expect(keys).toEqual(expect.arrayContaining([
            "core:prune-revisions", "core:expire-warnings", "core:process-broadcasts",
            "core:process-email-queue", "core:retention-prune", "core:health-alerting",
            "core:prune-ip-blocks", "core:automated-backup",
        ]));
        expect(new Set(keys).size).toBe(keys.length);
    });

    it("is idempotent", async () => {
        vi.useFakeTimers();
        const { bootstrapScheduler, listRegisteredJobs } = await load();

        await bootstrapScheduler();
        const first = listRegisteredJobs().length;
        await bootstrapScheduler();

        // instrumentation.ts runs once, but a stray second call must not
        // start a second interval ticking alongside the first.
        expect(listRegisteredJobs()).toHaveLength(first);
        expect(vi.getTimerCount()).toBe(2);
    });

    it("registers module jobs under module:id", async () => {
        vi.useFakeTimers();
        const handler = vi.fn(async () => { });
        moduleCrons = [
            { module: "blog", id: "digest", schedule: "every-day", loader: async () => ({ default: handler }) },
        ];
        const { bootstrapScheduler, listRegisteredJobs } = await load();

        await bootstrapScheduler();

        expect(listRegisteredJobs()).toContainEqual({ key: "blog:digest", schedule: "every-day" });
    });

    it("skips a module job with no default export and keeps the rest", async () => {
        vi.useFakeTimers();
        moduleCrons = [
            { module: "blog", id: "broken", schedule: "every-day", loader: async () => ({ default: "not a function" }) },
            { module: "forum", id: "ok", schedule: "every-hour", loader: async () => ({ default: async () => { } }) },
        ];
        const { bootstrapScheduler, listRegisteredJobs } = await load();

        await bootstrapScheduler();

        const keys = listRegisteredJobs().map((j) => j.key);
        expect(keys).not.toContain("blog:broken");
        expect(keys).toContain("forum:ok");
    });

    it("skips a module job whose loader throws and keeps the rest", async () => {
        vi.useFakeTimers();
        moduleCrons = [
            { module: "blog", id: "boom", schedule: "every-day", loader: async () => { throw new Error("bad import"); } },
            { module: "forum", id: "ok", schedule: "every-hour", loader: async () => ({ default: async () => { } }) },
        ];
        const { bootstrapScheduler, listRegisteredJobs } = await load();

        await bootstrapScheduler();

        expect(listRegisteredJobs().map((j) => j.key)).toContain("forum:ok");
    });

    it("ignores a module job with an unknown schedule", async () => {
        vi.useFakeTimers();
        moduleCrons = [
            { module: "blog", id: "x", schedule: "every-eternity", loader: async () => ({ default: async () => { } }) },
        ];
        const { bootstrapScheduler, listRegisteredJobs } = await load();

        await bootstrapScheduler();

        expect(listRegisteredJobs().map((j) => j.key)).not.toContain("blog:x");
    });

    it("still starts when the generated cron registry does not exist", async () => {
        vi.useFakeTimers();
        cronsImportThrows = true;
        const { bootstrapScheduler, listRegisteredJobs } = await load();

        // module-crons.ts is absent on a first build; core jobs must still run.
        await expect(bootstrapScheduler()).resolves.toBeUndefined();
        expect(listRegisteredJobs().length).toBeGreaterThan(0);
    });

    it("stops ticking on shutdown", async () => {
        vi.useFakeTimers();
        const { bootstrapScheduler } = await load();
        await bootstrapScheduler();
        expect(vi.getTimerCount()).toBe(2);

        shutdownHandlers.get("scheduler")!();

        // A live setInterval keeps the event loop open, so the process hangs
        // until the supervisor SIGKILLs it.
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe("tick and claimJob", () => {
    /** tick() runs the whole registry sequentially and is not awaited by the
     *  timer callback, so drain the microtask chain it leaves behind. */
    async function drain(): Promise<void> {
        for (let i = 0; i < 200; i += 1) await Promise.resolve();
    }

    /** Bootstrap with one module job added, and run the first tick. */
    async function tickOnce(handler: () => Promise<void>, schedule = "every-hour") {
        vi.useFakeTimers();
        moduleCrons = [{ module: "t", id: "job", schedule, loader: async () => ({ default: handler }) }];
        const mod = await load();
        await mod.bootstrapScheduler();
        await vi.advanceTimersByTimeAsync(5_000);
        await drain();
        return mod;
    }

    /** The claim statement issued for one job key. */
    function claimFor(key: string): RawCall | undefined {
        return rawCalls.find((c) => c.values[0] === key);
    }

    /** The CronRun bookkeeping write for one job key. */
    function runRecordFor(key: string) {
        return updateCalls.find((c) => (c.where as { jobKey: string }).jobKey === key);
    }

    it("claims the slot with an interval derived from the schedule", async () => {
        const handler = vi.fn(async () => { });
        await tickOnce(handler, "every-15-minutes");

        const claim = claimFor("t:job")!;
        expect(claim.sql).toContain("ON CONFLICT");
        // Seconds, not milliseconds: make_interval(secs => 900) for 15 minutes.
        // Passing 900000 would make every job due once a decade.
        expect(claim.values[1]).toBe(900);
    });

    it("runs the handler when this worker wins the claim", async () => {
        const handler = vi.fn(async () => { });
        claimAffected = 1;
        await tickOnce(handler);

        expect(handler).toHaveBeenCalledOnce();
        expect(runRecordFor("t:job")).toBeDefined();
    });

    it("does not run the handler when another worker won the claim", async () => {
        const handler = vi.fn(async () => { });
        claimAffected = 0;
        await tickOnce(handler);

        // This is the entire cluster-safety story: an affected-row count of
        // zero means somebody else is already running this interval.
        expect(handler).not.toHaveBeenCalled();
        expect(updateCalls).toHaveLength(0);
        // Every job in the registry is claimed and every claim is refused.
        expect(rawCalls.length).toBeGreaterThan(0);
    });

    it("does not run the handler when the claim query fails", async () => {
        const handler = vi.fn(async () => { });
        claimAffected = new Error("deadlock detected");
        await tickOnce(handler);

        // Failing closed: a claim we could not make is a claim we do not have.
        expect(handler).not.toHaveBeenCalled();
    });

    it("skips the whole tick while shutting down", async () => {
        vi.useFakeTimers();
        const handler = vi.fn(async () => { });
        moduleCrons = [{ module: "t", id: "job", schedule: "every-hour", loader: async () => ({ default: handler }) }];
        const mod = await load();
        await mod.bootstrapScheduler();

        shuttingDown = true;
        await vi.advanceTimersByTimeAsync(5_000);
        await drain();

        // Starting a fresh job inside the shutdown grace window is how a
        // clean stop turns into a SIGKILL half way through a backup.
        expect(handler).not.toHaveBeenCalled();
        expect(rawCalls).toHaveLength(0);
    });

    it("ticks again on the minute after the first delayed tick", async () => {
        const handler = vi.fn(async () => { });
        await tickOnce(handler);
        expect(handler).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(60_000);
        await drain();
        expect(handler).toHaveBeenCalledTimes(2);
    });

    it("keeps ticking the remaining jobs past one that throws", async () => {
        vi.useFakeTimers();
        const good = vi.fn(async () => { });
        moduleCrons = [
            { module: "t", id: "bad", schedule: "every-hour", loader: async () => ({ default: async () => { throw new Error("x"); } }) },
            { module: "t", id: "good", schedule: "every-hour", loader: async () => ({ default: good }) },
        ];
        const mod = await load();
        await mod.bootstrapScheduler();
        await vi.advanceTimersByTimeAsync(5_000);
        await drain();

        expect(good).toHaveBeenCalledOnce();
    });
});

describe("what the retention sweep reports", () => {
    // The sweep summed four of its five counts by hand and listed the same
    // four in its log line, so the count added last was invisible: a night
    // that pruned nothing but the admin audit trail said nothing at all.
    it("counts and names every table the sweep touched", async () => {
        vi.useFakeTimers();
        pruned = { activityLog: 7, activityFeed: 0, revision: 0, userSession: 0, verificationToken: 0 };
        const { log } = await import("@/core/lib/logger");
        const { bootstrapScheduler, runJobNow } = await load();
        await bootstrapScheduler();

        await runJobNow("core:retention-prune");

        const sweep = (log.info as unknown as { mock: { calls: unknown[][] } }).mock.calls
            .find((call) => String(call[0]).includes("retention sweep"));
        expect(sweep, "a sweep that deleted something says so").toBeTruthy();
        expect(sweep![1]).toMatchObject({ activityLog: 7 });
    });
});
