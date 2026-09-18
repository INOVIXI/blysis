import { log } from "@/core/sdk/server";
import { syncLiteBans } from "../lib/sync";

/**
 * Reads the game server's punishments on the scheduler.
 *
 * Every five minutes rather than every minute: a ban appearing on the site
 * five minutes after it was handed down is a ban list, and this is a query
 * against somebody else's production database - the game server's - which is
 * already busy doing the thing the punishments came from.
 *
 * A failure is logged and swallowed. The scheduler records the run either way,
 * and the settings screen is where an operator finds out whether the
 * connection works, with a sentence that names the kind of failure rather than
 * the driver's own, which carries the host and sometimes the password.
 */
export default async function syncPunishments(): Promise<void> {
    try {
        const summary = await syncLiteBans();

        if (summary.failed) {
            // Not configured is the ordinary state of a module nobody has set
            // up. Saying it every five minutes would bury the real failures.
            if (summary.failed !== "not-configured") {
                log.warn("cron: litebans sync could not read", {
                    job: "minecraft-litebans:sync",
                    reason: summary.failed,
                });
            }
            return;
        }

        if (summary.read > 0) {
            log.info("cron: litebans sync complete", {
                job: "minecraft-litebans:sync",
                read: summary.read,
                recorded: summary.recorded,
                skipped: summary.skipped,
            });
        }
    } catch (err) {
        log.error("[cron] minecraft-litebans sync failed", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
