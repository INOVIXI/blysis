/**
 * Take a database backup from the terminal.
 *
 * The same backup the panel's "Back up now" takes, through the same library,
 * so it lands in `backups/` under a name the backup screen lists, is dumped
 * with the flags a restore needs, and counts against the same retention.
 *
 * Usage:
 *   npm run db:backup
 *   npm run db:backup -- "before the forum migration"
 */

import "dotenv/config";
import { createBackup, formatBytes } from "../src/core/lib/backup";

void (async () => {
    const notes = process.argv.slice(2).join(" ");
    try {
        const meta = await createBackup("manual", notes || undefined);
        console.log(`Backup saved: backups/${meta.filename} (${formatBytes(meta.sizeBytes)})`);
        // The same warning the server's `blysis backup` prints: a restore on
        // another machine is useless without the key the secrets were sealed with.
        console.log("It does not contain .env. Secrets sealed with SECRET_ENCRYPTION_KEY cannot be read without it.");
        process.exit(0);
    } catch (err) {
        console.error(`Backup failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
})();
