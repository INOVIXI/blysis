/**
 * Building a read against the game server's database.
 *
 * Two things here are not ours and both have to be handled rather than
 * assumed.
 *
 * The table name is partly an operator's: LiteBans lets a server rename its
 * tables, and a name typed into a settings form ends up concatenated into a
 * query, because SQL will bind a value and never an identifier. So a name is
 * refused unless it is a name, rather than escaped into one - escaping is a
 * thing you can get subtly wrong, refusing is not. What is accepted is quoted
 * anyway, and the two dialects quote differently.
 *
 * The column list is theirs entirely. LiteBans has added columns over the
 * years and an operator may be running a version from before any of them, so
 * naming `silent` on a server that has never had it fails the whole read.
 * `wantedColumns` is given what the server says it has and keeps the overlap.
 * `SELECT *` would sidestep that and is the wrong answer twice over: it hands
 * back whatever else the table holds, which here is every punished player's
 * IP address, and it makes the row shape depend on the other server's version.
 */

import type { Dialect } from "./dialect";

/** How each dialect wraps a name it has been given. */
const QUOTE: Record<Dialect, [string, string]> = {
    postgres: ['"', '"'],
    mysql: ["`", "`"],
};

/** Letters, digits and underscores, starting with a letter. Nothing else. */
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Postgres will not take an identifier longer than this, and nor will we. */
const MAX_NAME = 63;

/** The most rows one read will ever ask for, however it is configured. */
export const MAX_BATCH = 1000;

/**
 * Without these there is no punishment: no id is no stable reference, so every
 * run would record the same row again under a new one; no `until` is no way to
 * tell a week from for ever.
 */
const REQUIRED = ["id", "until"] as const;

/**
 * What is read when the server has it. Ordered so a reader can see what the
 * record is built from - nothing else in the table is asked for, in
 * particular not `ip`.
 */
const WANTED = [
    "id",
    "uuid",
    "reason",
    "banned_by_name",
    "time",
    "until",
    "active",
    "silent",
    // `litebans.api.Entry` carries `removedByName` and `removalReason`, so the
    // plugin has them; what its SQL calls them could not be read out of the
    // jar, whose string constants are encrypted. These are the names the
    // schema is documented with. Getting them wrong costs nothing, which is
    // the point of asking the server which columns it has: a name it does not
    // recognise is simply not selected, and the record keeps the shape it had
    // before this line existed.
    "removed_by_name",
    "removed_by_reason",
    // Which server or game mode the punishment was handed down on. LiteBans
    // divides one database this way, so a site running Survival and Skyblock
    // off one install can keep them apart without a second connection.
    "server_scope",
] as const;

/**
 * The name, quoted and safe to concatenate, or null when it is not a name.
 *
 * The pattern is ASCII on purpose. A name that is only unicode which looks
 * like letters is not something somebody types by hand.
 */
export function safeIdentifier(name: string, dialect: Dialect): string | null {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_NAME) return null;
    if (!NAME.test(trimmed)) return null;
    const [open, close] = QUOTE[dialect];
    return `${open}${trimmed}${close}`;
}

/**
 * The columns to select, given what the server reports having, or null when
 * it is missing one the record cannot be built without.
 */
export function wantedColumns(serverHas: readonly string[]): string[] | null {
    const has = new Set(serverHas.map((column) => column.trim().toLowerCase()));
    for (const column of REQUIRED) {
        if (!has.has(column)) return null;
    }
    return WANTED.filter((column) => has.has(column));
}

/**
 * Which of the two things that change on the other server is being looked for.
 *
 * A new punishment always has a higher id than the last one read, so a cursor
 * finds it. A lift does not - it flips `active` on a row read long ago and
 * leaves the id alone - so it is looked for separately, in a window behind the
 * cursor. Re-reading the whole table every few minutes to catch it would be
 * somebody else's database scanning its ban table all day.
 */
export type Scope = "new" | "lifted";

export interface QueryRequest {
    /** The whole table name, prefix included, as the operator configured it. */
    table: string;
    columns: readonly string[];
    dialect: Dialect;
    scope: Scope;
    batch: number;
    /** The highest id already read from this table. */
    cursor?: number;
    /** How far behind the cursor a lift is still noticed. */
    window?: number;
}

export type BuiltQuery =
    | { text: string; values: number[] }
    | { refuse: "bad-identifier" | "no-columns" };

export function punishmentQuery(request: QueryRequest): BuiltQuery {
    if (request.columns.length === 0) return { refuse: "no-columns" };

    const table = safeIdentifier(request.table, request.dialect);
    if (!table) return { refuse: "bad-identifier" };

    const columns: string[] = [];
    for (const column of request.columns) {
        const safe = safeIdentifier(column, request.dialect);
        if (!safe) return { refuse: "bad-identifier" };
        columns.push(safe);
    }

    const id = safeIdentifier("id", request.dialect) as string;
    const active = safeIdentifier("active", request.dialect) as string;
    const cursor = Math.max(0, Math.floor(request.cursor ?? 0));
    const batch = Number.isFinite(request.batch)
        ? Math.min(MAX_BATCH, Math.max(1, Math.floor(request.batch)))
        : 1;

    // The placeholder is the driver's, not ours: `$n` in one, `?` in the
    // other. It is a bound value in both, which is the part that matters.
    let next = 0;
    const mark = () => (request.dialect === "mysql" ? "?" : `$${++next}`);

    const values: number[] = [];
    let where: string;
    let order: string;

    if (request.scope === "new") {
        where = `${id} > ${mark()}`;
        values.push(cursor);
        // Oldest first, so a run that stops halfway leaves a cursor that can
        // be picked up rather than a hole behind it.
        order = `${id} ASC`;
    } else {
        const floor = Math.max(0, cursor - Math.max(1, Math.floor(request.window ?? 0)));
        where = `${id} <= ${mark()} AND ${id} > ${mark()} AND ${active} = 0`;
        values.push(cursor, floor);
        // Newest first: a lift is far more likely to be of something recent,
        // and the batch cuts off the far end of the window rather than the
        // near one.
        order = `${id} DESC`;
    }

    values.push(batch);
    return {
        text: `SELECT ${columns.join(", ")} FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ${mark()}`,
        values,
    };
}
