import { log } from "@/core/sdk/server";
import { syncLibertyBans } from "../lib/sync";

/**
 * Reads the game server's punishments on the scheduler.
 *
 * Every five minutes rather than every minute: a ban appearing on the site five
 * minutes after it was handed down is a ban list, and this is a query against
 * the game server's production database, which is already busy doing the thing
 * the punishments came from.
 *
 * A failure is logged and swallowed. The settings screen is where an operator
 * finds out whether the connection works, with a sentence that names the kind
 * of failure rather than the driver's own, which carries the host and
 * sometimes the password.
 */
export default async function syncPunishments(): Promise<void> {
    try {
        const summary = await syncLibertyBans();

        if (summary.failed) {
            // Not configured is the ordinary state of a module nobody has set
            // up. Saying it every five minutes would bury the real failures.
            if (summary.failed !== "not-configured") {
                log.warn("cron: libertybans sync could not read", {
                    job: "minecraft-libertybans:sync",
                    reason: summary.failed,
                });
            }
            return;
        }

        if (summary.read > 0) {
            log.info("cron: libertybans sync complete", {
                job: "minecraft-libertybans:sync",
                read: summary.read,
                recorded: summary.recorded,
                skipped: summary.skipped,
            });
        }
    } catch (err) {
        log.error("[cron] minecraft-libertybans sync failed", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
