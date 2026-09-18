/**
 * The four tables a punishment can be in, and what being in one means.
 *
 * LiteBans has no column saying what kind of punishment a row is. The kind is
 * which table the row is in, which is why its own API has four separate
 * lookups - `getBan(id)`, `getMute(id)`, `getWarning(id)`, `getKick(id)` -
 * rather than one. That also means the id in a row is only unique inside its
 * own table, and a reference built from the number alone collides.
 *
 * The prefix is an operator's, because LiteBans lets a server rename its
 * tables and a site sharing a database with something else will have. It is
 * validated as an identifier before it reaches a query; see `query.ts`.
 */

/** What this site calls each of the four, before a duration is considered. */
export type PunishmentKind = "ban" | "mute" | "warning" | "kick";

export interface LiteBansTable {
    /** What follows the operator's prefix. */
    suffix: string;
    kind: PunishmentKind;
    /**
     * A ban and a mute can be handed down for a period and then have a second
     * name. A warning and a kick happen once and are over, so a date in
     * `until` on one of those describes when it stops being counted, not a
     * sentence being served.
     */
    canRun: boolean;
}

export const PUNISHMENT_TABLES: readonly LiteBansTable[] = [
    { suffix: "bans", kind: "ban", canRun: true },
    { suffix: "mutes", kind: "mute", canRun: true },
    { suffix: "warnings", kind: "warning", canRun: false },
    { suffix: "kicks", kind: "kick", canRun: false },
];

/** Where the names live. A punishment table holds a UUID and never a name. */
export const HISTORY_SUFFIX = "history";

/** The prefix a LiteBans install has unless its operator changed it. */
export const DEFAULT_PREFIX = "litebans_";
