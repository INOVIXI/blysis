import { prisma } from "./db";
import { log } from "./logger";
import { syncDisplayedRole } from "./roles";

/**
 * A role held for a while, and what happens when the while is up.
 *
 * This used to be the hardest thing in the role system. A member held exactly
 * one role, so giving one out for thirty days meant remembering what they held
 * before and putting it back, and the sweep could be wrong in two directions
 * that cost opposite things: leave somebody a rank they stopped paying for, or
 * silently undo an operator's own promotion months after they made it. The
 * code that walked that line is gone, and so is the column it read.
 *
 * A member holds a set now. The lapsed row goes and the rest of the set is
 * untouched: there is nothing to put back and nothing to guess. What is left
 * is to keep the displayed role true afterwards, because that is a cache of
 * the top of the set and the top may have just changed.
 *
 * Who granted a role is a string the granter chooses. This file never names
 * one, and never learns what kinds of thing hand roles out.
 */

/** How many lapsed rows one sweep takes, so a backlog cannot stall a cron. */
const SWEEP_BATCH = 500;

/**
 * Take back every role whose time is up, and answer how many rows went.
 *
 * A member whose badge cannot be recomputed - the account was deleted between
 * the read and the write - does not abandon the sweep. The row has already
 * gone by then, which is the part that matters; the badge of an account that
 * no longer exists is nobody's problem.
 */
export async function sweepLapsedRoles(now: Date = new Date()): Promise<number> {
    const lapsed = await prisma.userRole.findMany({
        where: { expiresAt: { lte: now } },
        select: { id: true, userId: true, roleId: true },
        take: SWEEP_BATCH,
    });
    if (lapsed.length === 0) return 0;

    const removed = await prisma.userRole.deleteMany({
        where: { id: { in: lapsed.map((row) => row.id) } },
    });

    // Once per member, not once per row: two lapsed ranks for one member is
    // one badge to recompute.
    for (const userId of new Set(lapsed.map((row) => row.userId))) {
        try {
            await syncDisplayedRole(userId);
        } catch (error) {
            log.warn("a lapsed role left a badge to recompute", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    if (removed.count > 0) log.info("timed roles taken back", { lapsed: removed.count });
    return removed.count;
}
