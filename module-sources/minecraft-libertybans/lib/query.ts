/**
 * Building a read against the game server's database.
 *
 * Two things here are not ours and both have to be handled rather than
 * assumed.
 *
 * The table names are partly an operator's: the prefix is a setting, for
 * tables copied in under another name, and a prefix typed into a form ends up
 * concatenated into a query, because SQL will bind a value and never an
 * identifier. So a name is
 * refused unless it is a name, rather than escaped into one. What is accepted
 * is quoted anyway, and the two dialects quote differently.
 *
 * The column list is theirs. `simple_history` has gained columns as
 * LibertyBans grew (`track` and `scope_type` arrived with server scopes), so
 * `wantedColumns` is given what the server says the view has and keeps the
 * overlap. `SELECT *` would hand back `victim_address`, every punished
 * player's IP address, which this module never reads.
 */

import type { Dialect } from "./dialect";
import { HISTORY_SUFFIX, STANDING_SUFFIXES, STANDING_TYPES } from "./tables";

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
 * Without these there is no punishment: no id is no stable reference, no type
 * is no telling a ban from a kick, no victim is nobody to record it against,
 * and no `start` and `end` is no telling a week from for ever.
 */
const REQUIRED = ["id", "type", "victim_type", "victim_uuid", "start", "end"] as const;

/**
 * What is read when the server has it. Nothing else in the view is asked for,
 * in particular not `victim_address`.
 */
const WANTED = [
    "id",
    "type",
    "victim_type",
    "victim_uuid",
    // A UUID, never a name. The console is the all-zero one; anybody else is
    // looked up in the names table like the victim is.
    "operator",
    "reason",
    // Which server or category it was handed down on. Empty for a punishment
    // that applies everywhere.
    "scope",
    "start",
    "end",
] as const;

/**
 * The name, quoted and safe to concatenate, or null when it is not a name.
 *
 * The pattern is ASCII on purpose. A name that is only unicode which looks like
 * letters is not something somebody types by hand.
 */
export function safeIdentifier(name: string, dialect: Dialect): string | null {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_NAME) return null;
    if (!NAME.test(trimmed)) return null;
    const [open, close] = QUOTE[dialect];
    return `${open}${trimmed}${close}`;
}

/**
 * The columns to select, given what the server reports the view having, or
 * null when it is missing one the record cannot be built without.
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
 * A new punishment always has a higher id than the last one read, because
 * every kind is numbered from one sequence, so a cursor finds it. A lift does
 * not: LibertyBans deletes the punishment from its kind's table and leaves the
 * history alone, so the id stays where it was, behind the cursor. It is looked
 * for separately, in a window behind the cursor, rather than by re-reading the
 * whole history every few minutes.
 */
export type Scope = "new" | "lifted";

export interface QueryRequest {
    /** The operator's prefix, which every table name starts with. */
    prefix: string;
    /** From `wantedColumns`. */
    columns: readonly string[];
    dialect: Dialect;
    scope: Scope;
    batch: number;
    /** The highest id already read. */
    cursor?: number;
    /** How far behind the cursor a lift is still noticed. */
    window?: number;
    /** Now, in epoch seconds, which is how LibertyBans stores `end`. */
    now: number;
}

export type BuiltQuery =
    | { text: string; values: number[] }
    | { refuse: "bad-identifier" | "no-columns" };

/** The column every row carries saying whether it is still in its kind's table. */
export const IN_FORCE = "in_force";

export function historyQuery(request: QueryRequest): BuiltQuery {
    if (request.columns.length === 0) return { refuse: "no-columns" };
    const ask = (name: string) => safeIdentifier(name, request.dialect);

    const history = ask(`${request.prefix}${HISTORY_SUFFIX}`);
    const standing = STANDING_SUFFIXES.map((suffix) => ask(`${request.prefix}${suffix}`));
    const h = ask("h") as string;
    const id = ask("id") as string;
    const type = ask("type") as string;
    const end = ask("end") as string;
    const inForce = ask(IN_FORCE) as string;
    if (!history || standing.some((table) => table === null)) return { refuse: "bad-identifier" };

    const columns: string[] = [];
    for (const column of request.columns) {
        const safe = ask(column);
        if (!safe) return { refuse: "bad-identifier" };
        columns.push(`${h}.${safe}`);
    }

    // Still in force is still in its kind's table. That is the only place
    // LibertyBans says it: there is no flag on the row to read.
    const held = `(${standing
        .map((table) => `EXISTS (SELECT 1 FROM ${table} WHERE ${table}.${id} = ${h}.${id})`)
        .join(" OR ")})`;

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
        where = `${h}.${id} > ${mark()}`;
        values.push(cursor);
        // Oldest first, so a run that stops halfway leaves a cursor that can
        // be picked up rather than a hole behind it.
        order = `${h}.${id} ASC`;
    } else {
        const floor = Math.max(0, cursor - Math.max(1, Math.floor(request.window ?? 0)));
        // Gone from its table and not because it ran out. LibertyBans deletes
        // an expired punishment from the same table a revoke deletes it from,
        // and only `end` tells the two apart: zero is permanent, so a
        // permanent one that is gone was lifted, and so was one whose end is
        // still ahead. A kick is never in a table, so it is never asked about.
        where = [
            `${h}.${id} <= ${mark()}`,
            `${h}.${id} > ${mark()}`,
            `${h}.${type} IN (${STANDING_TYPES.join(", ")})`,
            `(${h}.${end} = 0 OR ${h}.${end} > ${mark()})`,
            `NOT ${held}`,
        ].join(" AND ");
        values.push(cursor, floor, Math.floor(request.now));
        // Newest first: a lift is far more likely to be of something recent,
        // and the batch cuts off the far end of the window rather than the
        // near one.
        order = `${h}.${id} DESC`;
    }

    values.push(batch);
    return {
        text: `SELECT ${columns.join(", ")}, CASE WHEN ${held} THEN 1 ELSE 0 END AS ${inForce} `
            + `FROM ${history} ${h} WHERE ${where} ORDER BY ${order} LIMIT ${mark()}`,
        values,
    };
}
