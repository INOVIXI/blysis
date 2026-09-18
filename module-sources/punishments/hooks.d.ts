/**
 * How a punishment gets in here from somewhere else.
 *
 * This module owns the record: what a member has been punished for, by whom,
 * until when. It used to own the ingest too - one API key, one payload shape,
 * one game server's plugin - which made a module called "Punishments" a
 * mirror of one particular piece of software.
 *
 * So the ingest moved out and this became a socket. A module that watches a
 * game server, a chat platform or anything else that bans people asks
 * `punishment.record`, and this module writes the row. The asker never
 * touches the table, and the row is the same shape whoever it came from.
 *
 * The contract lives here even though this module answers rather than asks,
 * for the reason the store's payment contract does: every recorder depends on
 * this module, so this file is always there, and one published shape beats
 * each of them inventing their own.
 */
interface PunishmentReport {
    /**
     * The id of the module reporting it. `site` is reserved for a punishment
     * an administrator issued here.
     */
    source: string;
    /** That system's own identifier, so a redelivery updates one row. */
    externalRef: string;
    /** The member, when the reporter could work out which member it is. */
    userId?: string | null;
    /** The name the other system knows them by. */
    playerName: string;
    playerUuid?: string | null;
    /** ban, mute, kick, warn - whatever the other system calls it. */
    type: string;
    reason?: string | null;
    /** As the other system words it: "7d", "permanent". */
    duration?: string | null;
    punishedBy?: string | null;
    expiresAt?: string | null;
    /** False when the report is that a punishment was lifted. */
    active?: boolean;
    /**
     * Who lifted it, and the reason they gave. A record that says only that a
     * ban stopped reads like it expired, which is the opposite of what an
     * appeal upheld means to the member it was against.
     */
    liftedBy?: string | null;
    liftReason?: string | null;
    /**
     * What the reporter calls the place this happened - LiteBans' server
     * scope, a game mode, a second server. Matched against the scopes an
     * operator has named; a key nothing matches leaves the punishment
     * unscoped rather than inventing a scope out of a machine's word for it.
     */
    scopeKey?: string | null;
}

interface PunishmentRecorded {
    /** False when nothing recorded it, which is how a caller knows to retry. */
    recorded: boolean;
    id: string | null;
}

declare global {
    interface BlysisFilterPayloads {
        "punishment.record": PunishmentRecorded;
    }

    interface BlysisFilterContexts {
        "punishment.record": PunishmentReport;
    }
}

export {};
