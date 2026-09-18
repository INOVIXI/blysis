import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * A scheduled job runs in a module graph nobody filled.
 *
 * `instrumentation.ts` bootstraps the hook bus once per process, but it does
 * that in its own module graph, and the registry it fills is not the one
 * another graph reads. Every other path that is about to ask a module a
 * question calls `ensureHooks` first - the catch-all before it renders a
 * module page, the SEO reader before it asks for routes - and `ensureHooks`
 * says so in as many words.
 *
 * The scheduler was the one that did not. So a job whose whole purpose is to
 * bring something in from outside and hand it to another module through a
 * filter got its own input back, unchanged, with no error and no log line:
 * `applyFiltersAsync` with no listeners registered returns what it was given.
 * The tell is a job that reports success in three milliseconds having written
 * nothing, which is indistinguishable from there being nothing to do.
 *
 * Cheap after the first call in a graph - it is a boolean comparison - so it
 * belongs on the tick rather than in each job that happens to remember.
 */

const ensureHooks = vi.fn(async () => {});
const ran: string[] = [];

vi.mock("@/core/lib/db", () => ({
    prisma: {
        // Tagged template: the job key is the first interpolated value, and
        // every claim succeeds so the registered job actually runs.
        $executeRaw: () => Promise.resolve(1),
        cronRun: { update: () => Promise.resolve({}) },
    },
}));
vi.mock("@/core/lib/module-cache", () => ({ getModuleStates: async () => ({}) }));
vi.mock("@/core/lib/shutdown", () => ({
    isShuttingDown: () => false,
    onShutdown: () => {},
    installShutdownHandlers: () => {},
}));
vi.mock("@/core/generated/module-crons", () => ({ ModuleCronJobs: [] }));
vi.mock("@/core/lib/hooks-bootstrap", () => ({
    ensureHooks: () => ensureHooks(),
    bootstrapHooks: async () => {},
}));
vi.mock("@/core/lib/logger", () => ({
    errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("a scheduled job finds the hook bus filled", () => {
    beforeEach(() => {
        ensureHooks.mockClear();
        ran.length = 0;
        vi.resetModules();
    });

    it("fills the bus before any job runs", async () => {
        const { registerCronJob, runDueJobs } = await import("@/core/lib/scheduler");

        registerCronJob({
            key: "test-module:ask",
            schedule: "every-minute",
            handler: async () => {
                // Whether the bus was filled is only interesting if it was
                // filled *before* the handler, so the order is the assertion.
                ran.push(ensureHooks.mock.calls.length > 0 ? "filled" : "empty");
            },
        });

        await runDueJobs();

        expect(ran).toContain("filled");
        expect(ran).not.toContain("empty");
    });

    it("does not make the bus somebody's reason to skip a tick", async () => {
        // A hook registry that will not load is a module problem, and it must
        // not stop core's own pruning jobs from running.
        ensureHooks.mockRejectedValueOnce(new Error("a listener would not import"));
        const { registerCronJob, runDueJobs } = await import("@/core/lib/scheduler");

        registerCronJob({
            key: "test-module:still-runs",
            schedule: "every-minute",
            handler: async () => {
                ran.push("ran");
            },
        });

        await expect(runDueJobs()).resolves.toBeDefined();
        expect(ran).toContain("ran");
    });
});
