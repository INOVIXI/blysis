/**
 * The connection to the game server's database.
 *
 * Everything dangerous was decided elsewhere: `query.ts` refuses a name that is
 * not a name and selects only columns the server admits to having, `dialect.ts`
 * says which database an address names, and `deadline.ts` gives up on this side
 * of the socket. What is left here is the connection.
 *
 * It is opened once per sync run and closed at the end. A pool held open
 * against somebody else's database between runs is a connection they did not
 * agree to keep.
 *
 * The session is told it may not write. The credentials should say so too, and
 * the settings screen asks for a read-only user, but a site should not rest on
 * somebody else's care. Nothing here ever writes to LibertyBans: the game
 * server is the authority on whether somebody is banned from it.
 *
 * And the driver is loaded only when an address actually names it.
 */

import { log } from "@/core/sdk/server";
import { withDeadline } from "./deadline";
import type { Dialect } from "./dialect";
import { historyQuery, safeIdentifier, wantedColumns, type QueryRequest } from "./query";
import type { LibertyBansRow } from "./row";
import { uuidBytes, uuidText } from "./uuid";

/** A game server's database is often on a box that goes away. A tick can wait; a page could not. */
const TIMEOUT_MS = 15_000;

/**
 * The most name rows one lookup will read. A UUID can have joined under many
 * names and the newest is the one wanted, so the read is newest-first and this
 * cuts off the old ones. One run asks about up to two thousand UUIDs (a victim
 * and an operator for each of a thousand rows), so this leaves each of them
 * room for several names; a UUID whose newest name still falls past it is
 * recorded under the UUID, as one the table does not know is.
 */
const NAME_ROWS = 10_000;

export type FailureCode = "unreachable" | "refused" | "no-such-table" | "timeout" | "failed";

/**
 * What an operator is told. Built from this list and never from the driver's
 * own sentence, which names the host, the user, and when an address fails to
 * parse, the password in full. The driver's words go to the log.
 */
const SAID: Record<FailureCode, string> = {
    unreachable: "The LibertyBans database did not answer.",
    refused: "The LibertyBans database refused the sign-in.",
    "no-such-table": "Those tables are not in that database. Check the prefix.",
    timeout: "The LibertyBans database took too long to answer.",
    failed: "The LibertyBans database could not be read.",
};

export function readerSafeError(err: unknown): { code: FailureCode; message: string } {
    const text = (err instanceof Error ? err.message : "").toLowerCase();
    let code: FailureCode = "failed";
    if (text.includes("econnrefused") || text.includes("enotfound") || text.includes("ehostunreach")) {
        code = "unreachable";
    } else if (
        text.includes("authentication failed")
        || text.includes("access denied")
        || text.includes("password")
        || text.includes("permission denied")
    ) {
        code = "refused";
    } else if (
        text.includes("does not exist")
        || text.includes("doesn't exist")
        || text.includes("unknown column")
        || text.includes("undefined table")
        || text.includes("unknown table")
    ) {
        code = "no-such-table";
    } else if (
        text.includes("timeout")
        || text.includes("etimedout")
        || text.includes("canceling statement")
        || text.includes("execution time exceeded")
    ) {
        code = "timeout";
    }
    return { code, message: SAID[code] };
}

type Rows = Record<string, unknown>[];

/** One open connection, in whichever dialect. Closed by `done`. */
interface Session {
    ask(text: string, values: unknown[]): Promise<Rows>;
    done(): Promise<void>;
}

async function openPostgres(connectionString: string): Promise<Session> {
    const { Pool } = await import("pg");
    const pool = new Pool({
        connectionString,
        max: 1,
        connectionTimeoutMillis: TIMEOUT_MS,
        // The credentials ought to be read-only; this makes a write impossible
        // even when they are not.
        options: "-c default_transaction_read_only=on",
        statement_timeout: TIMEOUT_MS,
    });
    return {
        async ask(text, values) {
            const answer = await withDeadline(pool.query(text, values), TIMEOUT_MS, () => {
                void pool.end().catch(() => {});
            });
            return answer.rows as Rows;
        },
        async done() {
            await pool.end().catch(() => {});
        },
    };
}

async function openMysql(connectionString: string): Promise<Session> {
    const mysql = await import("mysql2/promise");
    const connection = await mysql.createConnection({
        uri: connectionString,
        connectTimeout: TIMEOUT_MS,
        // Off by default in this driver, and named anyway: the whole of
        // `query.ts` exists because one statement must stay one statement.
        multipleStatements: false,
        // `start` and `end` are BIGINT. They fit a double for any date this
        // side of the year 287 million, and a number is what `row.ts` wants.
        supportBigNumbers: true,
        bigNumberStrings: false,
    });
    await connection.query("SET SESSION TRANSACTION READ ONLY");
    return {
        async ask(text, values) {
            const [rows] = await withDeadline(connection.query(text, values), TIMEOUT_MS, () => {
                void connection.destroy();
            });
            return Array.isArray(rows) ? (rows as Rows) : [];
        },
        async done() {
            await connection.end().catch(() => {});
        },
    };
}

/** What a caller does with an open connection. */
export interface LibertyBansReader {
    /** The columns that table or view has, lowercased. Empty when it is not there. */
    columnsOf(table: string): Promise<string[]>;
    /** The rows a read asks for, or null when the query could not be built. */
    punishments(request: QueryRequest): Promise<LibertyBansRow[] | null>;
    /** The newest name each UUID joined under, keyed by dashed UUID. Unknown UUIDs are absent. */
    namesFor(namesTable: string, uuids: string[]): Promise<Map<string, string>>;
}

export type ReadOutcome<T> = { value: T } | { failed: FailureCode; message: string };

/**
 * Opens the connection, hands it to `work`, and closes it however that ends.
 *
 * Shaped as a callback rather than as an object the caller closes, because the
 * caller is a scheduler tick: an early return or a throw that skipped a
 * `close()` would leak a socket every five minutes for as long as the process
 * lives.
 */
export async function withLibertyBans<T>(
    connectionString: string,
    dialect: Dialect,
    work: (reader: LibertyBansReader) => Promise<T>,
): Promise<ReadOutcome<T>> {
    let session: Session | null = null;
    try {
        session = dialect === "mysql"
            ? await openMysql(connectionString)
            : await openPostgres(connectionString);
        const open = session;

        const reader: LibertyBansReader = {
            async columnsOf(table) {
                // The table name is bound as a value here, not concatenated:
                // this asks *about* a name rather than using one. Views are
                // listed here as well as tables, in both dialects.
                const rows = dialect === "mysql"
                    ? await open.ask(
                        "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?",
                        [table],
                    )
                    : await open.ask(
                        "SELECT column_name FROM information_schema.columns WHERE table_name = $1",
                        [table],
                    );
                return rows
                    .map((row) => String(row.column_name ?? row.COLUMN_NAME ?? "").toLowerCase())
                    .filter((name) => name !== "");
            },

            async punishments(request) {
                const built = historyQuery(request);
                if ("refuse" in built) return null;
                const rows = await open.ask(built.text, built.values);
                return rows as unknown as LibertyBansRow[];
            },

            async namesFor(namesTable, uuids) {
                const found = new Map<string, string>();
                const wanted = [...new Set(uuids)];
                if (wanted.length === 0) return found;

                const table = safeIdentifier(namesTable, dialect);
                const uuid = safeIdentifier("uuid", dialect);
                const name = safeIdentifier("name", dialect);
                const updated = safeIdentifier("updated", dialect);
                if (!table || !uuid || !name || !updated) return found;

                // One statement rather than one per player. The UUID column is
                // BINARY(16) on MariaDB and MySQL, so the bytes are what is
                // bound there; PostgreSQL takes the text.
                const marks = wanted
                    .map((_, at) => (dialect === "mysql" ? "?" : `$${at + 1}::uuid`))
                    .join(", ");
                const limit = dialect === "mysql" ? "?" : `$${wanted.length + 1}`;
                const bound = dialect === "mysql" ? wanted.map(uuidBytes) : wanted;
                const rows = await open.ask(
                    `SELECT ${uuid}, ${name} FROM ${table} WHERE ${uuid} IN (${marks}) ORDER BY ${updated} DESC LIMIT ${limit}`,
                    [...bound, NAME_ROWS],
                );

                // Newest first, so the first answer for a UUID is the name
                // they joined under last and later rows are older names.
                for (const row of rows) {
                    const key = uuidText(row.uuid ?? row.UUID);
                    const value = String(row.name ?? row.NAME ?? "").trim();
                    if (key && value !== "" && !found.has(key)) found.set(key, value);
                }
                return found;
            },
        };

        return { value: await work(reader) };
    } catch (err) {
        const safe = readerSafeError(err);
        log.error("[minecraft-libertybans] a read failed", {
            dialect,
            code: safe.code,
            error: err instanceof Error ? err.message : String(err),
        });
        return { failed: safe.code, message: safe.message };
    } finally {
        await session?.done();
    }
}

/** Re-exported so a caller does not need both this file and `query.ts` to ask a question. */
export { wantedColumns };
