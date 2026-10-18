/**
 * POST /api/v1/game-connect/admin/jobs/[id] - a person's decision on a job.
 *
 * `mark-done` closes a job in review or failed without running it again.
 * `send-again` puts it back in the queue: for a job in review that is the
 * admin saying it did not run. `cancel` withdraws a job nobody has taken yet.
 * With `group: true` the decision covers every job of the same purchase on
 * the same server, so a resend keeps its order.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logActivity, prisma, rateLimitForRole, readJsonBody } from "@/core/sdk/server";
import { auth } from "@/core/sdk/auth";
import { requireManager } from "../../../../lib/admin";
import { resolveByAdmin } from "../../../../lib/queue";

type RouteParams = { params: Promise<{ id: string }> };

/** The audit name of each decision, written out so the log can name it. */
const AUDIT_ACTION = {
    "mark-done": "game-connect.job.mark-done",
    "send-again": "game-connect.job.send-again",
    cancel: "game-connect.job.cancel",
} as const;

const decisionSchema = z.object({
    action: z.enum(["mark-done", "send-again", "cancel"]),
    group: z.boolean().optional(),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
    const manager = await requireManager(await auth());
    if (manager instanceof NextResponse) return manager;
    const limited = await rateLimitForRole(`game-connect-admin:${manager.userId}`, { maxRequests: 60, windowMs: 60_000 }, null);
    if (!limited.success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    const { id } = await params;

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Say what to do" }, { status: 400 });

    const job = await prisma.gameConnectJob.findUnique({ where: { id }, select: { groupKey: true } });
    if (!job) return NextResponse.json({ error: "Not found", code: "not_found" }, { status: 404 });

    const ids = parsed.data.group
        ? (
              await prisma.gameConnectJob.findMany({
                  where: { groupKey: job.groupKey },
                  orderBy: { sequence: "asc" },
                  select: { id: true },
              })
          ).map((row) => row.id)
        : [id];

    const changed: string[] = [];
    for (const jobId of ids) {
        if (await resolveByAdmin(jobId, parsed.data.action, manager.userId)) changed.push(jobId);
    }
    if (changed.length === 0) {
        return NextResponse.json({ error: "That job is not in a state this applies to", code: "wrong_state" }, { status: 409 });
    }
    await logActivity({
        userId: manager.userId,
        action: AUDIT_ACTION[parsed.data.action],
        entity: "game-connect-job",
        entityId: id,
        metadata: { jobs: changed },
    }).catch(() => {});
    return NextResponse.json({ changed });
}
