/**
 * One LiteBans row, as a punishment this site can record.
 *
 * Everything in here is a difference between how LiteBans says a thing and how
 * the punishments module says it, and each one has cost something:
 *
 * The reference carries the kind. LiteBans numbers each table on its own, so
 * ban 42 and mute 42 both exist; the record is unique on (source, reference),
 * and a reference of "42" means the second one read overwrites the first.
 *
 * The duration is the sentence, not the time left to serve it. LiteBans keeps
 * `time` and `until` and its own API measures between them. Measuring from now
 * gives a number that shrinks every minute, so a thirty day ban read three
 * weeks late would be recorded as a seven day ban.
 *
 * A permanent punishment has no duration rather than the word "permanent".
 * The screen prints its own translated word when this is empty, and a literal
 * written here reaches a Turkish reader in English.
 *
 * The name is not in the table. A punishment row holds a UUID; the name lives
 * in the history table and is looked up separately, and that lookup misses for
 * anyone not seen since. The UUID stands in rather than the row being dropped.
 *
 * A silent punishment is not copied at all. The flag exists so the ban is not
 * announced, and a public list is an announcement.
 *
 * `active` is a BIT column, and a driver hands BIT back as a number, a boolean
 * or a Buffer depending on the server. Every one of those is truthy, including
 * the zero that means the ban was lifted.
 */

import type { PunishmentKind } from "./tables";

/**
 * A row as the driver returns it. Every column but the id is optional, because
 * the read selects only what the server reported having.
 */
export interface LiteBansRow {
    id: number | string | bigint;
    uuid?: string | null;
    reason?: string | null;
    banned_by_name?: string | null;
    time?: number | string | null;
    until?: number | string | null;
    active?: number | boolean | string | null;
    silent?: number | boolean | string | null;
    removed_by_name?: string | null;
    removed_by_reason?: string | null;
    server_scope?: string | null;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A BIT, a TINYINT or a boolean, reduced to the answer. */
function flag(value: number | boolean | string | null | undefined): boolean | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    // A Buffer or a string reaches here: mysql2 hands BIT back as a Buffer
    // unless the query casts it, and its zero prints as an empty string.
    const text = String(value).trim();
    return text !== "" && text !== "0" && text.toLowerCase() !== "false";
}

function millis(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const ms = typeof value === "string" ? Number(value) : value;
    return Number.isFinite(ms) ? ms : null;
}

/**
 * How long it runs, in the words the admin form already uses for a punishment
 * issued here: "7d", "12h", "30m". Null when it does not end.
 */
function durationOf(placed: number | null, ends: number | null): string | null {
    if (ends === null) return null;
    // A re-read of an old punishment has to give the same answer as the first
    // read, so the span is measured from when it was placed. Only a row whose
    // `time` the server did not give up falls back to now.
    const span = ends - (placed ?? Date.now());
    if (span <= 0) return null;
    if (span >= DAY) return `${Math.round(span / DAY)}d`;
    if (span >= HOUR) return `${Math.round(span / HOUR)}h`;
    return `${Math.max(1, Math.round(span / MINUTE))}m`;
}

/** The place a row names, or null when it names none. */
function scopeOf(value: string | null | undefined): string | null {
    const scope = value?.trim() ?? "";
    return scope === "" || scope === "*" ? null : scope;
}

/** What this module calls itself in the record. One place: the reference is built from it. */
export const SOURCE = "minecraft-litebans";

export interface PunishmentReportDraft {
    source: string;
    externalRef: string;
    playerName: string;
    playerUuid: string | null;
    type: string;
    reason: string | null;
    duration: string | null;
    punishedBy: string | null;
    expiresAt: string | null;
    active: boolean;
    liftedBy: string | null;
    liftReason: string | null;
    scopeKey: string | null;
}

/**
 * The punishment, or null when the row is not one this site records: a silent
 * punishment, or one with nothing at all to identify who it is about.
 */
export function toReport(
    row: LiteBansRow,
    kind: PunishmentKind,
    /** From the history table, or null when it did not know this UUID. */
    playerName: string | null,
    /**
     * What the operator called this connection, for a server that does not
     * divide its own database. The row's own scope wins where there is one.
     */
    fallbackScope: string | null = null,
): PunishmentReportDraft | null {
    if (flag(row.silent) === true) return null;

    const name = playerName?.trim() || row.uuid?.trim() || "";
    if (name === "") return null;

    const until = millis(row.until);
    // LiteBans writes 0 for a permanent punishment and its API reports -1.
    // Both mean "does not end", and so does a column the server did not have.
    const ends = until !== null && until > 0 ? until : null;
    const runs = ends !== null && (kind === "ban" || kind === "mute");
    const lifted = (flag(row.active) ?? true) === false;

    return {
        source: SOURCE,
        externalRef: `${kind}:${String(row.id)}`,
        playerName: name,
        playerUuid: row.uuid?.trim() || null,
        type: runs ? (kind === "ban" ? "tempBan" : "tempMute") : kind,
        reason: row.reason?.trim() || null,
        duration: durationOf(millis(row.time), ends),
        punishedBy: row.banned_by_name?.trim() || null,
        expiresAt: ends === null ? null : new Date(ends).toISOString(),
        // A server too old to have the column, or a read that did not select
        // it, means nothing has said this was lifted.
        active: flag(row.active) ?? true,
        // Only meaningful on a lifted row. LiteBans leaves these set after a
        // ban is re-issued against the same player, so reading them on a
        // standing punishment would credit the wrong staff member with
        // lifting something that was never lifted.
        liftedBy: lifted ? row.removed_by_name?.trim() || null : null,
        liftReason: lifted ? row.removed_by_reason?.trim() || null : null,
        // LiteBans writes `*` for a punishment that applies everywhere, which
        // names no place and is not a scope.
        scopeKey: scopeOf(row.server_scope) ?? fallbackScope,
    };
}
