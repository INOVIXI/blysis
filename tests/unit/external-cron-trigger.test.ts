import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { stripComments } from "./source-text";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const code = (source: string) =>
    stripComments(source);

/**
 * The documented external cron trigger did not drive the scheduler.
 *
 * The deployment guide tells an operator to point a system cron at
 * `POST /api/v1/admin/cron` with an API key, and said the endpoint "runs
 * maintenance tasks registered by installed modules (expiring coupons,
 * closing stale tickets, etc.)". It did nothing of the kind. It called
 * `runScheduledTasks()`, a parallel list that knew about one core cleanup and
 * nothing about a registered job, core's or a module's. `tick()` is what runs
 * registered jobs, and only the in-process ticker ever called it.
 *
 * So an operator who followed the deployment guide, on the sort of host where
 * an in-process ticker is exactly what you cannot rely on, ran none of the
 * jobs they were told they were running. And the one cleanup that list did
 * hold - expiring VerificationToken rows - never ran either, because the admin
 * panel drives per-job runs through `/admin/cron/[key]/run` and never posts to
 * this endpoint at all.
 */

describe("POST /api/v1/admin/cron", () => {
    const route = read("src/app/api/v1/admin/cron/route.ts");

    it("runs the jobs that are due", () => {
        expect(code(route)).toContain("runDueJobs()");
    });

    it("no longer calls a task list that runs beside the scheduler", () => {
        expect(code(route)).not.toContain("runScheduledTasks");
        expect(fs.existsSync(path.join(root, "src/core/lib/scheduled-tasks.ts"))).toBe(false);
    });

    it("still admits an API key with the cron:run permission", () => {
        // This is how an external cron authenticates; losing it would leave
        // the operator's crontab silently unauthorised.
        expect(route).toContain('validateApiKey(rawKey, "cron:run")');
    });

    it("reports which jobs it ran", () => {
        expect(route).toContain("jobs, ran: jobs.length");
    });
});

describe("the scheduler", () => {
    const scheduler = read("src/core/lib/scheduler.ts");

    it("exposes a tick an external trigger can drive", () => {
        expect(scheduler).toContain("export async function runDueJobs()");
        expect(scheduler).toContain("await bootstrapScheduler()");
    });

    it("claims each job, so two triggers cannot run one twice", () => {
        // The in-process ticker and an external cron race on the same CronRun
        // row; the claim is what makes exactly one of them win the interval.
        const tick = scheduler.slice(
            scheduler.indexOf("async function tick()"),
            scheduler.indexOf("export async function runDueJobs()"),
        );
        // The cadence is resolved on the tick - a job whose cadence is a
        // setting reads it here - and the claim is made on the resolved one.
        expect(tick).toContain("const cadence = await cadenceOf(job)");
        expect(tick).toContain("await claimJob(job.key, cadence)");
        expect(scheduler).toContain("ON CONFLICT");
    });

    it("registers the retention sweep that now owns the token prune", () => {
        // Where the token prune lives is a fact about retention.ts, not about
        // a line of the scheduler's log call. This used to assert the log
        // named `verificationToken`, which stopped being true the day the log
        // started reading its counts off the result instead of listing them -
        // while the guarantee the test is named for stayed exactly as true.
        expect(scheduler).toContain('key: "core:retention-prune"');
        expect(code(read("src/core/lib/retention.ts")))
            .toContain("prisma.verificationToken.deleteMany");
    });
});
