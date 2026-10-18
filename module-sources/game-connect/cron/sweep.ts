/**
 * Housekeeping that no poll would do on its own.
 *
 * Polls expire leases as they run, but a site whose servers have all gone
 * quiet has nobody polling, and a claim held by a server that died must still
 * reach review. Old events, spent codes and kept answers go here too.
 */
import { log, prisma } from "@/core/sdk/server";
import { expireLeases } from "../lib/queue";
import { sweepEvents } from "../lib/events";

/** How long the first answer to a money call is kept for a retry. */
const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

export default async function sweep(): Promise<void> {
    const now = new Date();
    try {
        const expired = await expireLeases(now);
        const events = await sweepEvents(now);
        const codes = await prisma.gameConnectLinkCode.deleteMany({ where: { expiresAt: { lt: now } } });
        const answers = await prisma.gameConnectIdempotency.deleteMany({
            where: { createdAt: { lt: new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS) } },
        });
        if (expired > 0) {
            log.warn("[game-connect] deliveries set aside for review after their lease ran out", { count: expired });
        }
        log.debug("[game-connect] sweep", { expired, events, codes: codes.count, answers: answers.count });
    } catch (error) {
        log.error("[game-connect] sweep failed", { error: error instanceof Error ? error.message : String(error) });
    }
}
