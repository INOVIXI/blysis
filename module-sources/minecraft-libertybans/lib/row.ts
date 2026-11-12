/**
 * One LibertyBans punishment, as a punishment this site can record.
 *
 * Everything in here is a difference between how LibertyBans says a thing and
 * how the punishments module says it:
 *
 * The reference is the id alone. LibertyBans numbers every kind from one
 * sequence, so ban 42 and mute 42 cannot both exist, and the id is what its
 * own `/unban <id>` and `/history` show staff.
 *
 * Times are epoch seconds, not milliseconds (`InstantConverter`), and an `end`
 * of zero is permanent (`EndInstantConverter`).
 *
 * The duration is the sentence, not the time left to serve it, so a thirty day
 * ban read three weeks late is still a thirty day ban. A permanent punishment
 * has no duration rather than the word "permanent": the screen prints its own
 * translated word when this is empty.
 *
 * Whether it was lifted is whether it is still in its kind's table, and a
 * punishment that ran out is gone from there too. One that ran out is reported
 * as standing with an end in the past, which is how the punishments module
 * reads an expiry, so a ban that lapses between two runs is not announced to
 * its member as lifted by somebody. A kick is never in a table and is over
 * when it happens.
 *
 * LibertyBans records no one who lifted a punishment and no reason for it, so
 * a lift here never names either.
 *
 * The names are not in the row. The victim and the operator are UUIDs, and a
 * name is looked up in the names table, which misses for a player who has not
 * joined since LibertyBans was installed. The UUID stands in rather than the
 * row being dropped. An address-only punishment names no player and is not
 * copied: what it is against is an IP address, and that does not go on a
 * public list.
 */

import { ADDRESS_VICTIM, KIND_BY_TYPE } from "./tables";
import { NIL_UUID, uuidText } from "./uuid";

/**
 * A row as the driver returns it. Every column but the required ones is
 * optional, because the read selects only what the server reported having.
 */
export interface LibertyBansRow {
    id: number | string | bigint;
    type: number | string;
    victim_type: number | string;
    /** A Buffer from MariaDB and MySQL, a string from PostgreSQL. */
    victim_uuid: unknown;
    operator?: unknown;
    reason?: string | null;
    scope?: string | null;
    start: number | string | bigint;
    end: number | string | bigint;
    /** 1 while it is still in its kind's table. Computed by the read. */
    in_force?: number | string | boolean | null;
}

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 24 * HOUR;

function whole(value: number | string | bigint | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number) : null;
}

/**
 * How long it runs, in the words the admin form already uses for a punishment
 * issued here: "7d", "12h", "30m". Null when it does not end.
 */
function durationOf(start: number | null, end: number | null): string | null {
    if (end === null || start === null) return null;
    const span = end - start;
    if (span <= 0) return null;
    if (span >= DAY) return `${Math.round(span / DAY)}d`;
    if (span >= HOUR) return `${Math.round(span / HOUR)}h`;
    return `${Math.max(1, Math.round(span / MINUTE))}m`;
}

/** What this module calls itself in the record. */
export const SOURCE = "minecraft-libertybans";

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

/** Who a row is against and who handed it down, as dashed UUIDs. */
export function uuidsOf(row: LibertyBansRow): string[] {
    return [uuidText(row.victim_uuid), uuidText(row.operator)]
        .filter((uuid): uuid is string => uuid !== null && uuid !== NIL_UUID);
}

/**
 * The punishment, or null when the row is not one this site records: one
 * against an address alone, one with no player in it, or a type this version
 * does not know.
 */
export function toReport(
    row: LibertyBansRow,
    /** The newest name each UUID joined under, from the names table. */
    names: ReadonlyMap<string, string>,
    /** Now, in epoch seconds. */
    now: number,
    /**
     * What the operator called this connection. The row's own scope wins where
     * it has one.
     */
    fallbackScope: string | null = null,
): PunishmentReportDraft | null {
    const kind = KIND_BY_TYPE[Number(row.type)];
    if (!kind) return null;
    if (Number(row.victim_type) === ADDRESS_VICTIM) return null;

    const uuid = uuidText(row.victim_uuid);
    // A composite victim carries the player's UUID beside the address; an
    // address victim carries the zero UUID, and so would a corrupted row.
    if (!uuid || uuid === NIL_UUID) return null;

    const start = whole(row.start);
    const endRaw = whole(row.end);
    const end = endRaw !== null && endRaw > 0 ? endRaw : null;
    const runs = end !== null && (kind === "ban" || kind === "mute");

    // A read that did not compute it has not said anything was lifted.
    const inForce = Number(row.in_force ?? 1) === 1;
    const ranOut = end !== null && end <= now;
    const lifted = kind !== "kick" && !inForce && !ranOut;

    const operator = uuidText(row.operator);
    // The console is the zero UUID, and an empty name is what the screen
    // already prints as the console in the reader's language.
    const punishedBy = !operator || operator === NIL_UUID ? null : names.get(operator) ?? operator;

    const scope = row.scope?.trim() ?? "";

    return {
        source: SOURCE,
        externalRef: String(row.id),
        playerName: names.get(uuid) ?? uuid,
        playerUuid: uuid,
        type: runs ? (kind === "ban" ? "tempBan" : "tempMute") : kind,
        reason: row.reason?.trim() || null,
        duration: durationOf(start, end),
        punishedBy,
        expiresAt: end === null ? null : new Date(end * 1000).toISOString(),
        active: !lifted,
        liftedBy: null,
        liftReason: null,
        scopeKey: scope === "" ? fallbackScope : scope,
    };
}
