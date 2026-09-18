/**
 * One pass over the game server's punishment tables.
 *
 * Two different things change on the other side and they are found in two
 * different ways. A new punishment always has a higher id than the last one
 * read, so the cursor finds it. A lift does not: it flips `active` on a row
 * read long ago and leaves the id alone, so a cursor walks straight past it
 * for ever. Re-reading the whole table every few minutes to catch that would
 * be somebody else's database scanning its ban list all day, so a lift is
 * looked for in a bounded window behind the cursor, and the settings screen
 * carries a full re-read for anything older than that.
 *
 * Nothing here writes a punishment. The row belongs to the punishments module
 * and goes in through `punishment.record`, which upserts on (source,
 * reference) - so a re-read of a row already recorded updates it rather than
 * adding a second, and that is what makes both the window and the full re-read
 * safe to run as often as an operator likes.
 *
 * The cursor only moves when the batch that advanced it was recorded. A run
 * that dies halfway through - the database goes away, the process is stopped
 * mid-tick - leaves the cursor where it was and the next run reads the same
 * rows again, which costs a few hundred upserts and loses nothing. Moving it
 * first would be the other way round: cheap, and a hole in a member's record
 * that nothing would ever notice.
 */

import { applyFiltersAsync } from "@/core/sdk";
import { log, prisma } from "@/core/sdk/server";
import { dialectOf } from "./dialect";
import { withLiteBans, wantedColumns, type FailureCode, type LiteBansReader } from "./read";
import { toReport, type LiteBansRow } from "./row";
import { readConfig } from "./settings";
import { HISTORY_SUFFIX, PUNISHMENT_TABLES, type LiteBansTable } from "./tables";

/** How many rows one kind gives up per run. Four kinds, so four times this at most. */
const BATCH = 200;

/** How far behind the cursor a lift is still noticed without a full re-read. */
const WINDOW = 2000;

export interface SyncSummary {
    /** Rows read from the other database. */
    read: number;
    /** Punishments written or updated here. */
    recorded: number;
    /** Rows deliberately not copied: silent, or with nothing to identify them. */
    skipped: number;
    /** Rows the punishments module would not write. Not zero means something is wrong. */
    refused: number;
    /** Kinds whose table this server does not have, or does not have enough of. */
    missing: string[];
    failed?: FailureCode | "not-configured" | "bad-address";
    message?: string;
}

const EMPTY: SyncSummary = { read: 0, recorded: 0, skipped: 0, refused: 0, missing: [] };

/** The highest id already read from one kind's table. */
async function cursorFor(kind: string): Promise<number> {
    const row = await prisma.liteBansSync.findUnique({ where: { kind }, select: { lastId: true } });
    return row ? Number(row.lastId) : 0;
}

async function moveCursor(kind: string, lastId: number): Promise<void> {
    await prisma.liteBansSync.upsert({
        where: { kind },
        update: { lastId: BigInt(lastId), syncedAt: new Date() },
        create: { kind, lastId: BigInt(lastId), syncedAt: new Date() },
    });
}

/**
 * Hands one batch of rows to the punishments module, one at a time.
 *
 * Sequentially on purpose. Both hooks reach the database, and a batch fired
 * off in parallel is two hundred concurrent queries from a background tick
 * against the pool every page on the site is also using.
 */
async function record(
    rows: LiteBansRow[],
    table: LiteBansTable,
    names: Map<string, string>,
    into: SyncSummary,
): Promise<void> {
    for (const row of rows) {
        const report = toReport(row, table.kind, names.get(String(row.uuid ?? "")) ?? null);
        if (!report) {
            into.skipped += 1;
            continue;
        }

        // Who this is, if this site knows. A name nobody has proved they own
        // gets a null and the punishment is still recorded under the name.
        const match = await applyFiltersAsync(
            "game-account.resolve",
            { userId: null },
            { uuid: report.playerUuid, username: report.playerName },
        );

        const outcome = await applyFiltersAsync(
            "punishment.record",
            { recorded: false, id: null },
            { ...report, userId: match.userId },
        );

        if (outcome.recorded) into.recorded += 1;
        else into.refused += 1;
    }
}

async function syncOneKind(
    reader: LiteBansReader,
    table: LiteBansTable,
    prefix: string,
    dialect: "postgres" | "mysql",
    full: boolean,
    into: SyncSummary,
): Promise<void> {
    const name = `${prefix}${table.suffix}`;
    const columns = wantedColumns(await reader.columnsOf(name));
    if (!columns) {
        // Either the table is not there - a server with no warnings table is
        // an ordinary thing - or it is too old to carry what a record needs.
        into.missing.push(table.kind);
        return;
    }

    const history = `${prefix}${HISTORY_SUFFIX}`;
    const cursor = full ? 0 : await cursorFor(table.kind);

    const fresh = (await reader.punishments({
        table: name, columns, dialect, scope: "new", batch: BATCH, cursor,
    })) ?? [];
    // Behind the cursor, so a first run and a full re-read have nothing to
    // look back at and do not ask.
    const lifted = cursor === 0
        ? []
        : (await reader.punishments({
            table: name, columns, dialect, scope: "lifted", batch: BATCH, cursor, window: WINDOW,
        })) ?? [];

    const rows = [...fresh, ...lifted];
    into.read += rows.length;
    if (rows.length === 0) return;

    const names = await reader.namesFor(
        history,
        rows.map((row) => String(row.uuid ?? "")),
    );
    await record(rows, table, names, into);

    // Only what the cursor scope returned moves it, and only after the batch
    // is in. The lifted rows are behind it by definition.
    const highest = fresh.reduce((top, row) => Math.max(top, Number(row.id)), cursor);
    if (highest > cursor) await moveCursor(table.kind, highest);
    else if (full) await moveCursor(table.kind, highest);
}

/**
 * Reads what has happened on the game server since the last run.
 *
 * `full` starts every kind from nothing, which is what an operator presses
 * after connecting for the first time or after a lift older than the window.
 * It is safe to press twice: every write is an upsert on a reference that does
 * not change.
 */
export async function syncLiteBans(options: { full?: boolean } = {}): Promise<SyncSummary> {
    const config = await readConfig();
    if (!config.enabled || config.connection === "") {
        return { ...EMPTY, failed: "not-configured", message: "No LiteBans database is connected." };
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
    const outcome = await withLiteBans(config.connection, dialect, async (reader) => {
        for (const table of PUNISHMENT_TABLES) {
            await syncOneKind(reader, table, config.prefix, dialect, options.full === true, summary);
        }
    });

    if ("failed" in outcome) {
        return { ...summary, failed: outcome.failed, message: outcome.message };
    }

    if (summary.refused > 0) {
        // The punishments module answered "not recorded". That is a real
        // fault on this side rather than a quiet one on theirs, so it is said
        // out loud even on an otherwise successful run.
        log.warn("[minecraft-litebans] some punishments were not recorded", {
            refused: summary.refused,
            read: summary.read,
        });
    }

    return summary;
}
