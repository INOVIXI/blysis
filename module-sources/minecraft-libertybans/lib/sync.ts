/**
 * One pass over the game server's punishment history.
 *
 * Two different things change on the other side and they are found in two
 * different ways. A new punishment always has a higher id than the last one
 * read, so the cursor finds it. A lift does not: LibertyBans deletes the
 * punishment from its kind's table and leaves its history row, id and all,
 * behind the cursor. Re-reading the whole history every few minutes to catch
 * that would be somebody else's database scanning its ban list all day, so a
 * lift is looked for in a bounded window behind the cursor, and the settings
 * screen carries a full re-read for anything older than that.
 *
 * Nothing here writes a punishment. The row belongs to the punishments module
 * and goes in through `punishment.record`, which upserts on (source,
 * reference), so a re-read of a row already recorded updates it rather than
 * adding a second.
 *
 * The cursor only moves when the batch that advanced it was recorded. A run
 * that dies halfway through leaves the cursor where it was and the next run
 * reads the same rows again, which costs a few hundred upserts and loses
 * nothing.
 */

import { applyFiltersAsync } from "@/core/sdk";
import { log, prisma } from "@/core/sdk/server";
import { dialectOf } from "./dialect";
import { memberFor } from "./member";
import { withLibertyBans, wantedColumns, type FailureCode } from "./read";
import { toReport, uuidsOf, type LibertyBansRow } from "./row";
import { readConfig } from "./settings";
import { HISTORY_SUFFIX, NAMES_SUFFIX } from "./tables";

/** How many rows one run reads past the cursor, and at most as many again behind it. */
const BATCH = 500;

/** How far behind the cursor a lift is still noticed without a full re-read. */
const WINDOW = 5000;

/**
 * The key of the one cursor. Every kind is numbered from one sequence, so one
 * place in it is enough; see `schema.prisma`.
 */
export const CURSOR = "history";

export interface SyncSummary {
    /** Rows read from the other database. */
    read: number;
    /** Punishments written or updated here. */
    recorded: number;
    /** Rows deliberately not copied: against an address alone, or of a kind this does not know. */
    skipped: number;
    /** Rows the punishments module would not write. Not zero means something is wrong. */
    refused: number;
    /** What this server does not have, or does not have enough of. */
    missing: string[];
    failed?: FailureCode | "not-configured" | "bad-address";
    message?: string;
}

const EMPTY: SyncSummary = { read: 0, recorded: 0, skipped: 0, refused: 0, missing: [] };

async function cursorAt(): Promise<number> {
    const row = await prisma.libertyBansSync.findUnique({ where: { kind: CURSOR }, select: { lastId: true } });
    return row ? Number(row.lastId) : 0;
}

async function moveCursor(lastId: number): Promise<void> {
    await prisma.libertyBansSync.upsert({
        where: { kind: CURSOR },
        update: { lastId: BigInt(lastId), syncedAt: new Date() },
        create: { kind: CURSOR, lastId: BigInt(lastId), syncedAt: new Date() },
    });
}

/**
 * Hands one batch of rows to the punishments module, one at a time.
 *
 * Sequentially on purpose. Both hooks reach the database, and a batch fired off
 * in parallel is hundreds of concurrent queries from a background tick against
 * the pool every page on the site is also using.
 */
async function record(
    rows: LibertyBansRow[],
    names: Map<string, string>,
    now: number,
    fallbackScope: string | null,
    into: SyncSummary,
): Promise<void> {
    for (const row of rows) {
        const report = toReport(row, names, now, fallbackScope);
        if (!report) {
            into.skipped += 1;
            continue;
        }

        const userId = await memberFor(report.playerUuid, report.playerName);

        const outcome = await applyFiltersAsync(
            "punishment.record",
            { recorded: false, id: null },
            { ...report, userId },
        );

        if (outcome.recorded) into.recorded += 1;
        else into.refused += 1;
    }
}

/**
 * Reads what has happened on the game server since the last run.
 *
 * `full` starts from nothing, which is what an operator presses after
 * connecting for the first time or after a lift older than the window. It is
 * safe to press twice: every write is an upsert on a reference that does not
 * change.
 */
export async function syncLibertyBans(options: { full?: boolean } = {}): Promise<SyncSummary> {
    const config = await readConfig();
    if (!config.enabled || config.connection === "") {
        return { ...EMPTY, failed: "not-configured", message: "No LibertyBans database is connected." };
    }

    const dialect = dialectOf(config.connection);
    if (!dialect) {
        return {
            ...EMPTY,
            failed: "bad-address",
            message: "That address names a database this cannot read. Use mysql://, mariadb:// or postgres://.",
        };
    }

    const summary: SyncSummary = { ...EMPTY, missing: [] };
    const fallbackScope = config.scopeKey || null;

    const outcome = await withLibertyBans(config.connection, dialect, async (reader) => {
        const columns = wantedColumns(await reader.columnsOf(`${config.prefix}${HISTORY_SUFFIX}`));
        if (!columns) {
            summary.missing.push(HISTORY_SUFFIX);
            return;
        }

        const now = Math.floor(Date.now() / 1000);
        const cursor = options.full === true ? 0 : await cursorAt();
        const base = { prefix: config.prefix, columns, dialect, batch: BATCH, cursor, now };

        const fresh = (await reader.punishments({ ...base, scope: "new" })) ?? [];
        // Behind the cursor, so a first run and a full re-read have nothing to
        // look back at and do not ask.
        const lifted = cursor === 0
            ? []
            : (await reader.punishments({ ...base, scope: "lifted", window: WINDOW })) ?? [];

        const rows = [...fresh, ...lifted];
        summary.read += rows.length;
        if (rows.length === 0) return;

        const names = await reader.namesFor(`${config.prefix}${NAMES_SUFFIX}`, rows.flatMap(uuidsOf));
        await record(rows, names, now, fallbackScope, summary);

        // Only what the cursor scope returned moves it, and only after the
        // batch is in. The lifted rows are behind it by definition.
        const highest = fresh.reduce((top, row) => Math.max(top, Number(row.id)), cursor);
        if (highest > cursor || options.full === true) await moveCursor(highest);
    });

    if ("failed" in outcome) {
        return { ...summary, failed: outcome.failed, message: outcome.message };
    }

    if (summary.refused > 0) {
        // The punishments module answered "not recorded". That is a fault on
        // this side, so it is said out loud even on an otherwise good run.
        log.warn("[minecraft-libertybans] some punishments were not recorded", {
            refused: summary.refused,
            read: summary.read,
        });
    }

    return summary;
}
