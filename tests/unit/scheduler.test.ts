import { describe, it, expect, vi } from "vitest";
import { listJobsWithSchedule, listRegisteredJobs, registerCronJob } from "@/core/lib/scheduler";

const { logWarn, logError } = vi.hoisted(() => ({ logWarn: vi.fn(), logError: vi.fn() }));
// The module under test is re-imported after `vi.resetModules()`, so a spy on
// the real logger would land on a different instance than the one it picks
// up. Mocking the module keeps one object on both sides.
vi.mock("@/core/lib/logger", () => ({
    
    errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),log: { warn: logWarn, error: logError, info: vi.fn(), debug: vi.fn() },
}));


describe("scheduler", () => {
    it("registers and lists jobs", async () => {
        const before = listRegisteredJobs().length;
        registerCronJob({
            key: "test:my-job",
            schedule: "every-hour",
            handler: async () => {},
        });
        const jobs = listRegisteredJobs();
        expect(jobs.length).toBe(before + 1);
        expect((await listJobsWithSchedule()).find((j) => j.key === "test:my-job")?.schedule).toBe("every-hour");
    });

    it("ignores unknown schedule", () => {
        // The refusal is reported through the structured logger; quietened so
        // a passing run stays readable. What is asserted is that nothing was
        // registered, which is what a caller can see.
        logWarn.mockClear();
        const before = listRegisteredJobs().length;
        registerCronJob({
            key: "test:bad",
            schedule: "every-eternity" as never,
            handler: async () => { },
        });
        // Job not registered → list count stays the same
        expect(listRegisteredJobs().length).toBe(before);
    });
});

/**
 * A job whose cadence is a setting resolves it on the tick.
 *
 * `core:automated-backup` used to be registered with the literal `every-day`.
 * Reading the operator's choice at registration would have been no better: a
 * cadence changed on the screen would not take until the site was restarted,
 * which is not a thing an operator has any reason to connect to a select box.
 */
describe("a job whose cadence is not fixed", () => {
    it("reports what it is set to now, not what it was registered with", async () => {
        let chosen = "every-day";
        registerCronJob({
            key: "test:reads-a-setting",
            schedule: async () => chosen,
            handler: async () => {},
        });

        const daily = await listJobsWithSchedule();
        expect(daily.find((j) => j.key === "test:reads-a-setting")?.schedule).toBe("every-day");

        chosen = "every-hour";
        const hourly = await listJobsWithSchedule();
        expect(hourly.find((j) => j.key === "test:reads-a-setting")?.schedule).toBe("every-hour");
    });

    it("is registered even though nothing can be validated yet", async () => {
        registerCronJob({
            key: "test:late-cadence",
            schedule: async () => "every-week",
            handler: async () => {},
        });
        expect((await listJobsWithSchedule()).some((j) => j.key === "test:late-cadence")).toBe(true);
    });

    it("falls back to a cadence the scheduler knows when the setting answers nonsense", async () => {
        // An unknown name is a job that never runs and says nothing, which is
        // the one failure mode a settable cadence introduces.
        registerCronJob({
            key: "test:nonsense-cadence",
            schedule: async () => "every-eternity",
            handler: async () => {},
        });
        const { SCHEDULE_MS } = await import("@/core/lib/cron-schedules");
        const resolved = (await listJobsWithSchedule()).find((j) => j.key === "test:nonsense-cadence")?.schedule;
        expect(SCHEDULE_MS[resolved as string]).toBeGreaterThan(0);
    });
});
