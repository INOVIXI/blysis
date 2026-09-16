import { prisma } from "@/core/lib/db";
import { sendEmail } from "@/core/lib/email";
import { errorText, log } from "./logger";

interface BroadcastFilter {
    all?: boolean;
    roleIds?: string[];
    userIds?: string[];
}

/**
 * Email broadcast helpers.
 *
 * The cron job "core:process-broadcasts" calls processQueuedBroadcasts()
 * once per minute. It picks up status="queued" rows, fans out the email
 * to the recipients in batches with a small delay to respect rate limits,
 * and updates progress columns.
 *
 * Send via the existing core/lib/email.ts, which delegates to whichever mail
 * provider is installed and active.
 */

/**
 * Who a broadcast goes to, as a filter rather than as a list.
 *
 * It used to be a list. Queueing read every recipient row so it could write
 * `recipients.length`, and sending read them all again and held the array for
 * the whole run - which is minutes, because the loop waits 200ms between
 * batches of fifty. Measured for a hundred thousand recipients: 32.5 MB of
 * ids, emails and usernames held for six and a half minutes, and 150.6 MB at
 * half a million.
 *
 * The empty-email guard is here rather than in JavaScript after the fact, so
 * the number `queueBroadcast` writes is the number `processQueuedBroadcasts`
 * will actually send to. The column is `String @unique` and cannot be null;
 * this is the empty string a bad import can leave.
 */
function recipientFilter(filter: BroadcastFilter): Record<string, unknown> {
    const where: Record<string, unknown> = { isBanned: false, email: { not: "" } };

    if (filter.userIds && filter.userIds.length > 0) {
        where.id = { in: filter.userIds };
    } else if (filter.roleIds && filter.roleIds.length > 0) {
        where.roleId = { in: filter.roleIds };
    }
    // filter.all = true → no extra constraint, everyone

    return where;
}

/** One page of recipients, in id order so the cursor is stable. */
async function recipientPage(
    filter: BroadcastFilter,
    take: number,
    after: string | null,
): Promise<{ id: string; email: string; username: string }[]> {
    return prisma.user.findMany({
        where: recipientFilter(filter),
        select: { id: true, email: true, username: true },
        orderBy: { id: "asc" },
        take,
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });
}

/** Queue a broadcast for delivery - sets status to "queued" and counts recipients. */
export async function queueBroadcast(broadcastId: string): Promise<{ totalCount: number }> {
    const broadcast = await prisma.emailBroadcast.findUnique({ where: { id: broadcastId } });
    if (!broadcast) throw new Error("Broadcast not found");

    const totalCount = await prisma.user.count({
        where: recipientFilter(broadcast.filter as BroadcastFilter),
    });
    await prisma.emailBroadcast.update({
        where: { id: broadcastId },
        data: { status: "queued", totalCount },
    });
    return { totalCount };
}

/**
 * How long a send may be in flight before nobody is running it.
 *
 * A broadcast holds `sending` for as long as its recipient list takes, and
 * the job that started it can go away mid-list: a deploy, a restart, the
 * rebuild an install triggers. The processor only looks for `queued`, so a
 * row left that way is never returned to and reads as sending for as long as
 * the database lives.
 *
 * An hour is well past any real list at fifty an a fifth of a second, and
 * short enough that an operator finds out the same day.
 */
const SEND_STALE_AFTER_MS = 60 * 60_000;

/** Cron-driven processor: picks up queued broadcasts, sends in batches. */
export async function processQueuedBroadcasts(): Promise<void> {
    // Close off a send nobody is running. Not resumed on purpose: `sentCount`
    // is written every five batches of fifty, so picking it up again would
    // mail as many as two hundred and fifty people a second time, and a
    // broadcast cannot be recalled. A failure an operator can see is the
    // better of the two.
    await prisma.emailBroadcast.updateMany({
        where: {
            status: "sending",
            startedAt: { lt: new Date(Date.now() - SEND_STALE_AFTER_MS) },
        },
        data: {
            status: "failed",
            lastError: "Interrupted before the send finished; not resumed, because the recipients already reached cannot be told apart",
            completedAt: new Date(),
        },
    });

    const broadcast = await prisma.emailBroadcast.findFirst({
        where: { status: "queued" },
        orderBy: { createdAt: "asc" },
    });
    if (!broadcast) return;

    await prisma.emailBroadcast.update({
        where: { id: broadcast.id },
        data: { status: "sending", startedAt: new Date() },
    });

    let sent = 0;
    let failed = 0;
    let lastError: string | null = null;

    // A page at a time, and the page is the batch: the list is never held
    // whole, so a broadcast to half a million people costs the same as one to
    // fifty. Read in id order with a cursor rather than an offset, so the
    // hundredth page is as cheap as the first.
    const BATCH = 50;
    let after: string | null = null;
    let batchIndex = 0;
    for (;;) {
        const batch = await recipientPage(broadcast.filter as BroadcastFilter, BATCH, after);
        if (batch.length === 0) break;
        after = batch[batch.length - 1].id;

        await Promise.all(batch.map(async (user) => {
            try {
                await sendEmail({
                    to: user.email,
                    subject: broadcast.subject,
                    html: broadcast.body.replace(/\{username\}/g, user.username),
                });
                sent++;
            } catch (err) {
                failed++;
                lastError = errorText(err);
            }
        }));

        // Periodic progress save (every 5 batches)
        if (batchIndex % 5 === 0) {
            await prisma.emailBroadcast.update({
                where: { id: broadcast.id },
                data: { sentCount: sent, failedCount: failed },
            });
        }
        batchIndex++;

        if (batch.length === BATCH) {
            await new Promise((r) => setTimeout(r, 200));
        }
    }

    await prisma.emailBroadcast.update({
        where: { id: broadcast.id },
        data: {
            status: failed > 0 && sent === 0 ? "failed" : "sent",
            sentCount: sent,
            failedCount: failed,
            lastError,
            completedAt: new Date(),
        },
    });

    log.info("broadcast complete", { broadcastId: broadcast.id, sent, failed });
}
