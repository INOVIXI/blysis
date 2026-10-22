/**
 * Restore a database backup from the terminal.
 *
 * Restores only what the panel's backup screen lists, by the id it shows or
 * by the file's path in `backups/`, through the same library the panel uses.
 * The dump drops every table before recreating it, so the question asks for
 * a word rather than a `y` a stray keypress could give.
 *
 * Usage:
 *   npm run db:restore                     # lists the backups
 *   npm run db:restore -- <id | backups/<file>.sql.gz>
 */

import "dotenv/config";
import path from "path";
import readline from "readline/promises";
import { listBackups, restoreBackup } from "../src/core/lib/backup";

const FILE_EXT = ".sql.gz";

/** The id a backup screen shows, from an id or from a path inside `backups/`. */
function idFrom(arg: string): string | null {
    if (!arg.endsWith(FILE_EXT)) return arg;
    const full = path.resolve(arg);
    if (path.dirname(full) !== path.resolve("backups")) return null;
    return path.basename(full, FILE_EXT);
}

void (async () => {
    const backups = await listBackups();
    const arg = process.argv[2];
    const id = arg ? idFrom(arg) : null;

    if (!id || !backups.some((b) => b.id === id)) {
        if (arg) console.error(`${arg} is not a backup in backups/.`);
        console.error("Usage: npm run db:restore -- <id>");
        console.error(backups.length ? "Backups:" : "There are no backups in backups/.");
        for (const b of backups) console.error(`  ${b.id}${b.notes ? `  ${b.notes}` : ""}`);
        process.exit(1);
    }

    // Stop the dev server first: the dump drops each table before recreating
    // it, and a write that lands in between is lost.
    console.log(`This overwrites the current database with ${id}. Stop the app before you go on.`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("Type the word restore to continue: ")).trim();
    rl.close();
    if (answer !== "restore") {
        console.log("Cancelled.");
        process.exit(0);
    }

    const result = await restoreBackup(id);
    if (!result.success) {
        console.error(`Restore failed: ${result.error}`);
        process.exit(1);
    }
    console.log(`Restored from ${id}.`);
    process.exit(0);
})();
