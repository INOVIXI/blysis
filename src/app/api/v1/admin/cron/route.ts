import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/core/lib/auth";
import { isAdmin } from "@/core/lib/permissions";
import { validateApiKey } from "@/core/lib/api-key-auth";
import { prisma } from "@/core/lib/db";
import { listJobsWithSchedule, bootstrapScheduler, runDueJobs } from "@/core/lib/scheduler";

interface CronJobRow {
    key: string;
    schedule: string;
    lastRunAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
    lastRunMs: number | null;
    nextRunAt: string | null;
}

// GET /api/v1/admin/cron - List registered jobs joined with their CronRun row
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Ensure module-contributed jobs are loaded so admins see the full list
    // even on a freshly booted dev process that has not yet ticked.
    await bootstrapScheduler();

    const registered = await listJobsWithSchedule();
    const runs = await prisma.cronRun.findMany();
    const runMap = new Map(runs.map((r) => [r.jobKey, r]));

    const jobs: CronJobRow[] = registered
        .map((j) => {
            const run = runMap.get(j.key);
            return {
                key: j.key,
                schedule: j.schedule,
                lastRunAt: run?.lastRunAt ? run.lastRunAt.toISOString() : null,
                lastStatus: run?.lastStatus ?? null,
                lastError: run?.lastError ?? null,
                lastRunMs: run?.lastRunMs ?? null,
                nextRunAt: run?.nextRunAt ? run.nextRunAt.toISOString() : null,
            };
        })
        .sort((a, b) => a.key.localeCompare(b.key));

    return NextResponse.json({ jobs });
}

/**
 * POST /api/v1/admin/cron - drive one scheduler tick from outside the process.
 *
 * This is the trigger an operator points an external cron at, for a host
 * where the in-process ticker cannot be relied
 * on. It used to call a parallel task list holding a single core cleanup and
 * nothing else, so an operator who wired it up ran none of core's registered
 * jobs and none of the modules', while the documentation said it ran both.
 *
 * Every job that is due now runs through the same claim the in-process ticker
 * uses, so the two triggers cannot execute one job twice inside its interval.
 */
export async function POST(request: NextRequest) {
    // Allow via API key or admin session
    const rawKey = request.headers.get("x-api-key");
    if (rawKey) {
        const result = await validateApiKey(rawKey, "cron:run");
        if (!result.valid) return NextResponse.json({ error: result.error }, { status: result.status });
    } else {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        if (!(await isAdmin(session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const jobs = await runDueJobs();
    return NextResponse.json({ jobs, ran: jobs.length });
}
