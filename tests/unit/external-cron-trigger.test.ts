// @vitest-environment node
/**
 * The documented external cron trigger drives the scheduler.
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
 * jobs they were told they were running.
 *
 * This holds the route to the scheduler's tick. That the tick claims each job
 * before running it, so the two triggers cannot run one twice, is
 * scheduler-lifecycle.test.ts; that the retention sweep it runs prunes expired
 * tokens is retention.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let session: { user: { id: string } } | null = null;
let admin = false;
let keyAnswer: { valid: true } | { valid: false; error: string; status: number } = { valid: true };
const validateApiKey = vi.fn(async () => keyAnswer);
const runDueJobs = vi.fn(async () => ["core:retention-prune", "module:shop:expire-coupons"]);

vi.mock("@/core/lib/auth", () => ({ auth: async () => session }));
vi.mock("@/core/lib/permissions", () => ({ isAdmin: async () => admin }));
vi.mock("@/core/lib/api-key-auth", () => ({ validateApiKey }));
vi.mock("@/core/lib/db", () => ({ prisma: {} }));
vi.mock("@/core/lib/scheduler", () => ({
    runDueJobs,
    bootstrapScheduler: async () => {},
    listJobsWithSchedule: async () => [],
}));

const { POST } = await import("@/app/api/v1/admin/cron/route");

const trigger = (key?: string) =>
    POST(
        new NextRequest("http://localhost/api/v1/admin/cron", {
            method: "POST",
            headers: key === undefined ? {} : { "x-api-key": key },
        }),
    );

beforeEach(() => {
    session = null;
    admin = false;
    keyAnswer = { valid: true };
    validateApiKey.mockClear();
    runDueJobs.mockClear();
});

describe("POST /api/v1/admin/cron", () => {
    it("runs the jobs that are due and says which", async () => {
        const res = await trigger("blysis_key");
        expect(res.status).toBe(200);
        expect(runDueJobs).toHaveBeenCalledTimes(1);
        expect(await res.json()).toEqual({
            jobs: ["core:retention-prune", "module:shop:expire-coupons"],
            ran: 2,
        });
    });

    it("admits an API key only for the cron:run permission", async () => {
        // This is how an external cron authenticates; losing it would leave
        // the operator's crontab silently unauthorised.
        await trigger("blysis_key");
        expect(validateApiKey).toHaveBeenCalledWith("blysis_key", "cron:run");
    });

    it("runs nothing for a key that is refused, and says why", async () => {
        keyAnswer = { valid: false, error: "Missing permission", status: 403 };
        const res = await trigger("blysis_key");
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "Missing permission" });
        expect(runDueJobs).not.toHaveBeenCalled();
    });

    it("runs nothing for a caller with neither a key nor a session", async () => {
        expect((await trigger()).status).toBe(401);
        expect(runDueJobs).not.toHaveBeenCalled();
    });

    it("runs nothing for a signed-in member who is not an admin", async () => {
        session = { user: { id: "member" } };
        expect((await trigger()).status).toBe(403);
        expect(runDueJobs).not.toHaveBeenCalled();
    });

    it("runs the tick for an admin session too", async () => {
        session = { user: { id: "admin" } };
        admin = true;
        expect((await trigger()).status).toBe(200);
        expect(runDueJobs).toHaveBeenCalledTimes(1);
    });
});
